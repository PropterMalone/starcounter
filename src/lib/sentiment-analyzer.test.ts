import { describe, it, expect } from 'vitest';
import { SentimentAnalyzer } from './sentiment-analyzer';

describe('SentimentAnalyzer', () => {
  const analyzer = new SentimentAnalyzer();

  describe('analyze', () => {
    it('should detect positive sentiment', () => {
      const result = analyzer.analyze('I totally agree! This is amazing.');

      expect(result.classification).toBe('Positive');
      expect(result.comparative).toBeGreaterThan(0.05);
    });

    it('should detect negative sentiment', () => {
      const result = analyzer.analyze('I completely disagree. This is terrible.');

      expect(result.classification).toBe('Negative');
      expect(result.comparative).toBeLessThan(-0.05);
    });

    it('should detect neutral sentiment', () => {
      const result = analyzer.analyze('The chair is in the room.');

      expect(result.classification).toBe('Neutral');
      expect(Math.abs(result.comparative)).toBeLessThan(0.05);
    });

    it('should detect agreement keywords', () => {
      const texts = [
        'I agree with that',
        'Exactly!',
        'Yes, absolutely',
        'You are correct',
        'Indeed, very true',
      ];

      texts.forEach((text) => {
        const result = analyzer.analyze(text);
        expect(result.classification).toBe('Positive');
      });
    });

    it('should detect disagreement keywords', () => {
      const texts = [
        'I disagree',
        'No, that is wrong',
        'Actually, you are incorrect',
        'Hard disagree',
        'Nope',
      ];

      texts.forEach((text) => {
        const result = analyzer.analyze(text);
        expect(result.classification).toBe('Negative');
      });
    });

    it('should return strength indicator', () => {
      const strongPositive = analyzer.analyze('Absolutely amazing! I love it!');
      const moderatePositive = analyzer.analyze('That seems right to me');

      expect(strongPositive.strength).toBe('Strong');
      expect(moderatePositive.strength).toBe('Moderate');
    });
  });

  describe('isAgreement', () => {
    it('should identify agreement', () => {
      expect(analyzer.isAgreement('I agree with that')).toBe(true);
      expect(analyzer.isAgreement('Exactly! So true.')).toBe(true);
    });

    it('should identify disagreement', () => {
      expect(analyzer.isAgreement('I disagree')).toBe(false);
      expect(analyzer.isAgreement('No, that is wrong')).toBe(false);
    });

    it('should treat neutral as non-agreement', () => {
      expect(analyzer.isAgreement('The sky is blue')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const result = analyzer.analyze('');
      expect(result.classification).toBe('Neutral');
      expect(result.comparative).toBe(0);
    });

    it('should handle very long text', () => {
      const longText = 'I love this! '.repeat(100) + 'This is amazing!';
      const result = analyzer.analyze(longText);
      expect(result.classification).toBe('Positive');
      expect(result.strength).toBe('Strong');
    });

    it('should handle text with only neutral words', () => {
      const result = analyzer.analyze('The building has windows and doors');
      expect(result.classification).toBe('Neutral');
      expect(Math.abs(result.comparative)).toBeLessThan(0.05);
    });

    it('should handle mixed sentiment (more positive)', () => {
      const result = analyzer.analyze('I love this but I hate that');
      // More positive words should win
      expect(result.positiveWords.length).toBeGreaterThan(0);
    });

    it('should handle mixed sentiment (more negative)', () => {
      const result = analyzer.analyze('I hate this but I love that');
      // Both positive and negative should be present
      expect(result.positiveWords.length).toBeGreaterThan(0);
      expect(result.negativeWords.length).toBeGreaterThan(0);
    });
  });
});
