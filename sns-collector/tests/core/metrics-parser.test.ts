import { describe, it, expect } from 'vitest';
import { parseMetricText } from '../../src/core/metrics-parser';

describe('parseMetricText', () => {
  it('should parse plain numbers', () => {
    expect(parseMetricText('123')).toEqual({ raw: '123', parsed: 123 });
  });

  it('should parse K suffix', () => {
    expect(parseMetricText('1.2K')).toEqual({ raw: '1.2K', parsed: 1200 });
  });

  it('should parse lowercase k suffix', () => {
    expect(parseMetricText('5.5k')).toEqual({ raw: '5.5k', parsed: 5500 });
  });

  it('should parse M suffix', () => {
    expect(parseMetricText('2.5M')).toEqual({ raw: '2.5M', parsed: 2500000 });
  });

  it('should parse comma-separated numbers', () => {
    expect(parseMetricText('1,234')).toEqual({ raw: '1,234', parsed: 1234 });
  });

  it('should parse large comma-separated numbers', () => {
    expect(parseMetricText('12,345,678')).toEqual({ raw: '12,345,678', parsed: 12345678 });
  });

  it('should return null parsed for empty string', () => {
    expect(parseMetricText('')).toEqual({ raw: '', parsed: null });
  });

  it('should return null parsed for em dash', () => {
    expect(parseMetricText('—')).toEqual({ raw: '—', parsed: null });
  });

  it('should return null parsed for regular dash', () => {
    expect(parseMetricText('-')).toEqual({ raw: '-', parsed: null });
  });

  it('should return null parsed for non-numeric text', () => {
    expect(parseMetricText('hello')).toEqual({ raw: 'hello', parsed: null });
  });

  it('should handle zero', () => {
    expect(parseMetricText('0')).toEqual({ raw: '0', parsed: 0 });
  });

  it('should trim whitespace', () => {
    expect(parseMetricText('  42  ')).toEqual({ raw: '42', parsed: 42 });
  });

  it('should parse Japanese 万 suffix (×10,000)', () => {
    expect(parseMetricText('2.7万')).toEqual({ raw: '2.7万', parsed: 27000 });
  });

  it('should parse Japanese 万 with integer', () => {
    expect(parseMetricText('15万')).toEqual({ raw: '15万', parsed: 150000 });
  });

  it('should parse Japanese 億 suffix (×100,000,000)', () => {
    expect(parseMetricText('1.5億')).toEqual({ raw: '1.5億', parsed: 150000000 });
  });
});
