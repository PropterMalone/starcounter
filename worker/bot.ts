// Starcounter Bot — Cloudflare Worker entry point.
// Cron-triggered: polls Bluesky notifications, analyzes threads, replies with results.

import type { Env } from './types';
import { SessionManager } from './bluesky-auth';
import {
  fetchNotifications,
  extractMentionTargets,
  updateSeenNotifications,
} from './notification-poller';
import type { MentionTarget } from './notification-poller';
import {
  getState,
  setState,
  getProcessedThread,
  saveProcessedThread,
  hasRepliedToMention,
  saveRepliedMention,
} from './state';
import { createShareFromResult } from './share-creator';
import { buildShareUrl } from './reply-composer';
import { analyzeThread } from '../src/lib/analyze';
import type { AnalysisResult } from '../src/lib/analyze';
import { BlueskyClient } from '../src/api/bluesky-client';

const STATE_KEY_CURSOR = 'notification_cursor';
const MAX_THREAD_POSTS = 2000;
const OG_IMAGE_URL = 'https://starcounter.pages.dev/api/og';
const OEMBED_API_URL = 'https://starcounter.pages.dev/api/oembed';

type BlobRef = {
  readonly $type: 'blob';
  readonly ref: { readonly $link: string };
  readonly mimeType: string;
  readonly size: number;
};
// Each thread analysis can make 50-200+ API requests (getPostThread, getQuotes, etc.).
// Cap per-run to stay well under Bluesky's 3000 req/5min rate limit.
const MAX_TARGETS_PER_RUN = 3;

type ProcessResult =
  | { readonly status: 'analyzed'; readonly shareId: string; readonly result: AnalysisResult }
  | { readonly status: 'cached'; readonly shareId: string }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'error'; readonly error: string };

/** Post a reply to a mention using com.atproto.repo.createRecord. */
async function postReply(
  accessJwt: string,
  botDid: string,
  record: Record<string, unknown>,
  service = 'https://bsky.social'
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${service}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo: botDid,
      collection: 'app.bsky.feed.post',
      record,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `createRecord failed: ${res.status} ${body}` };
  }

  return { ok: true };
}

/** Fetch the OG image for a share and upload it as a Bluesky blob. */
async function uploadOgImage(
  shareId: string,
  accessJwt: string,
  service = 'https://bsky.social'
): Promise<BlobRef | null> {
  // Fetch OG image from our Pages Function
  const ogRes = await fetch(`${OG_IMAGE_URL}?s=${shareId}`);
  if (!ogRes.ok) return null;

  const imageBytes = await ogRes.arrayBuffer();

  // Upload as blob to Bluesky
  const uploadRes = await fetch(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessJwt}`,
      'Content-Type': 'image/png',
    },
    body: imageBytes,
  });

  if (!uploadRes.ok) return null;

  const data = (await uploadRes.json()) as { blob: BlobRef };
  return data.blob;
}

/** Resolve the CID for a post given its AT-URI. */
async function resolvePostCid(
  uri: string,
  accessJwt: string,
  service = 'https://bsky.social'
): Promise<string | null> {
  const parts = uri.match(/^at:\/\/(did:[^/]+)\/([^/]+)\/(.+)$/);
  if (!parts) return null;

  const [, repo, collection, rkey] = parts;
  const params = new URLSearchParams({ repo: repo!, collection: collection!, rkey: rkey! });
  const res = await fetch(`${service}/xrpc/com.atproto.repo.getRecord?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessJwt}` },
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { cid?: string };
  return data.cid ?? null;
}

/** Build reply text with summary stats. Link comes from the embed card. */
function buildReplyText(
  shareId: string,
  result?: AnalysisResult
): { text: string; shareUrl: string } {
  const shareUrl = buildShareUrl(shareId);

  if (!result) {
    return { text: 'Here are your results!', shareUrl };
  }

  const totalHits = result.mentionCounts.reduce((sum, mc) => sum + mc.count, 0);
  const text = `Scanned ${result.postCount} posts, found ${totalHits} hits across ${result.mentionCounts.length} categories.`;
  return { text, shareUrl };
}

/** Build the full reply record for com.atproto.repo.createRecord. */
function buildReply(
  shareId: string,
  target: MentionTarget,
  rootCid: string,
  result?: AnalysisResult,
  thumbBlob?: BlobRef | null
): Record<string, unknown> {
  const { text, shareUrl } = buildReplyText(shareId, result);

  // Build alt text for the link card image (description doubles as alt text)
  const altText = result
    ? `Bar chart of thread analysis results. ${result.mentionCounts.length} categories from ${result.postCount} posts. Top result: ${result.mentionCounts[0]?.mention ?? 'none'} with ${result.mentionCounts[0]?.count ?? 0} mentions.`
    : 'Thread analysis results chart';

  const record: Record<string, unknown> = {
    $type: 'app.bsky.feed.post',
    text,
    reply: {
      root: { uri: target.rootUri, cid: rootCid },
      parent: { uri: target.mentionUri, cid: target.mentionCid },
    },
    createdAt: new Date().toISOString(),
  };

  if (thumbBlob) {
    record.embed = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: shareUrl,
        title: 'Starcounter Results',
        description: altText,
        thumb: thumbBlob,
      },
    };
  }

  return record;
}

/** Process a single mention target: analyze thread or return cached result. */
async function processTarget(
  target: MentionTarget,
  db: D1Database,
  client: BlueskyClient
): Promise<ProcessResult> {
  // Check for cached result regardless of media type.
  // Re-analysis for different media types can be triggered manually via the web app.
  const existing = await getProcessedThread(db, target.rootUri);
  if (existing) {
    return { status: 'cached', shareId: existing.shareId };
  }

  try {
    const result = await analyzeThread(target.rootUri, client, {
      oembedApiUrl: OEMBED_API_URL,
    });

    if (result.postCount > MAX_THREAD_POSTS) {
      return { status: 'skipped', reason: `thread too large: ${result.postCount} posts` };
    }

    const shareId = await createShareFromResult(db, result);

    await saveProcessedThread(db, {
      threadUri: target.rootUri,
      shareId,
      processedAt: Date.now(),
      mentionCount: result.mentionCounts.length,
      postCount: result.postCount,
    });

    return { status: 'analyzed', shareId, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', error: message };
  }
}

/** Main bot loop: authenticate, fetch notifications, process mentions, reply. */
export async function runBot(
  env: Env,
  debug = false
): Promise<{ processed: number; errors: number; debug?: string[] }> {
  const log: string[] = [];
  const auth = new SessionManager({
    handle: env.BSKY_HANDLE,
    password: env.BSKY_PASSWORD,
  });

  // Authenticate
  const tokenResult = await auth.getAccessToken();
  if (!tokenResult.ok) {
    console.error('auth failed:', tokenResult.error);
    return {
      processed: 0,
      errors: 1,
      ...(debug && { debug: ['auth failed: ' + tokenResult.error] }),
    };
  }

  const accessJwt = tokenResult.value;
  const botDid = auth.getDid()!;
  log.push(`auth ok, did=${botDid}`);

  // Set up analysis client with auth token
  const client = new BlueskyClient();
  client.setAccessToken(accessJwt);

  // Fetch notifications
  const cursor = await getState(env.SHARED_RESULTS, STATE_KEY_CURSOR);
  const notifResult = await fetchNotifications(
    accessJwt,
    'https://bsky.social',
    cursor ?? undefined
  );

  if (!notifResult.ok) {
    console.error('fetchNotifications failed:', notifResult.error);
    return {
      processed: 0,
      errors: 1,
      ...(debug && { debug: [...log, 'notif failed: ' + notifResult.error] }),
    };
  }

  const { notifications, cursor: newCursor } = notifResult.value;
  log.push(`notifications=${notifications.length}, cursor=${newCursor}`);
  log.push(`reasons: ${notifications.map((n) => n.reason).join(', ')}`);

  const allTargets = extractMentionTargets(notifications, botDid);
  const targets = allTargets.slice(0, MAX_TARGETS_PER_RUN);
  log.push(`targets=${allTargets.length}, processing=${targets.length}`);

  if (allTargets.length > MAX_TARGETS_PER_RUN) {
    console.log(
      `rate-limiting: processing ${targets.length} of ${allTargets.length} targets this run`
    );
  }

  let processed = 0;
  let errors = 0;

  for (const target of targets) {
    // Skip mentions we've already replied to
    const alreadyReplied = await hasRepliedToMention(env.SHARED_RESULTS, target.mentionUri);
    if (alreadyReplied) {
      log.push(`skipping ${target.mentionUri} — already replied`);
      continue;
    }

    log.push(`processing ${target.rootUri}`);
    const result = await processTarget(target, env.SHARED_RESULTS, client);
    log.push(`result: ${result.status}${result.status === 'error' ? ' - ' + result.error : ''}`);

    if (result.status === 'error') {
      console.error(`error processing ${target.rootUri}:`, result.error);
      errors++;
      continue;
    }

    if (result.status === 'skipped') {
      console.log(`skipped ${target.rootUri}: ${result.reason}`);
      continue;
    }

    // Resolve root CID for reply threading
    const rootCid = await resolvePostCid(target.rootUri, accessJwt);
    if (!rootCid) {
      console.error(`could not resolve CID for ${target.rootUri}`);
      errors++;
      continue;
    }

    // Upload OG image for link card (non-fatal if it fails)
    const thumbBlob = await uploadOgImage(result.shareId, accessJwt);
    log.push(`og image: ${thumbBlob ? 'uploaded' : 'skipped'}`);

    // Build and post reply (with top mentions for fresh analyses, link-only for cached)
    const analysisResult = result.status === 'analyzed' ? result.result : undefined;
    const replyRecord = buildReply(result.shareId, target, rootCid, analysisResult, thumbBlob);

    const postResult = await postReply(accessJwt, botDid, replyRecord);
    if (!postResult.ok) {
      console.error(`reply failed for ${target.rootUri}:`, postResult.error);
      errors++;
      continue;
    }

    await saveRepliedMention(env.SHARED_RESULTS, target.mentionUri, target.rootUri, Date.now());
    processed++;
    console.log(`replied to ${target.rootUri} → share ${result.shareId}`);
  }

  // Update cursor and mark notifications as seen
  if (newCursor) {
    await setState(env.SHARED_RESULTS, STATE_KEY_CURSOR, newCursor);
  }
  if (notifications.length > 0) {
    await updateSeenNotifications(accessJwt, 'https://bsky.social', new Date().toISOString());
  }

  return { processed, errors, ...(debug && { debug: log }) };
}

// Cloudflare Worker handlers
export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const result = await runBot(env);
    console.log(`bot run complete: ${result.processed} processed, ${result.errors} errors`);
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const result = await runBot(env, true);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('starcountr bot ok', { status: 200 });
  },
};
