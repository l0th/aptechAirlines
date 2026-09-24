import { calculateGreatCircleMiles } from './distance.util';

describe('DistanceUtil - Great Circle Distance (Haversine)', () => {
  it('calculates realistic distance between SGN and HAN (domestic trunk route)', () => {
    // SGN (Tan Son Nhat): 10.8188° N, 106.6519° E
    // HAN (Noi Bai): 21.2212° N, 105.8072° E
    const distance = calculateGreatCircleMiles(10.8188, 106.6519, 21.2212, 105.8072);
    // Great circle distance SGN-HAN is approximately 720 - 730 statute miles
    expect(distance).toBeGreaterThanOrEqual(715);
    expect(distance).toBeLessThanOrEqual(735);
    expect(distance).toBe(721);
  });

  it('calculates realistic distance between SGN and NRT (international long haul)', () => {
    // SGN: 10.8188° N, 106.6519° E
    // NRT: 35.7647° N, 140.3863° E
    const distance = calculateGreatCircleMiles(10.8188, 106.6519, 35.7647, 140.3863);
    // Great circle distance SGN-NRT is approximately 2700 - 2750 statute miles
    expect(distance).toBeGreaterThanOrEqual(2700);
    expect(distance).toBeLessThanOrEqual(2750);
    expect(distance).toBe(2724);
  });

  it('calculates realistic distance between SGN and DAD (central corridor)', () => {
    // SGN: 10.8188° N, 106.6519° E
    // DAD: 16.0439° N, 108.1994° E
    const distance = calculateGreatCircleMiles(10.8188, 106.6519, 16.0439, 108.1994);
    expect(distance).toBeGreaterThanOrEqual(370);
    expect(distance).toBeLessThanOrEqual(385);
    expect(distance).toBe(376);
  });

  it('proves different routes produce different realistic distances, never constant', () => {
    const sgnHan = calculateGreatCircleMiles(10.8188, 106.6519, 21.2212, 105.8072);
    const sgnNrt = calculateGreatCircleMiles(10.8188, 106.6519, 35.7647, 140.3863);
    const sgnDad = calculateGreatCircleMiles(10.8188, 106.6519, 16.0439, 108.1994);

    expect(sgnHan).not.toBe(sgnNrt);
    expect(sgnHan).not.toBe(sgnDad);
    expect(sgnNrt).toBeGreaterThan(sgnHan * 3);
  });

  it('returns 0 for identical coordinates', () => {
    const distance = calculateGreatCircleMiles(10.8188, 106.6519, 10.8188, 106.6519);
    expect(distance).toBe(0);
  });

  it('returns 0 when any coordinate is missing, null, or undefined', () => {
    expect(calculateGreatCircleMiles(undefined, 106.6519, 21.2212, 105.8072)).toBe(0);
    expect(calculateGreatCircleMiles(10.8188, null as any, 21.2212, 105.8072)).toBe(0);
    expect(calculateGreatCircleMiles(10.8188, 106.6519, undefined, 105.8072)).toBe(0);
    expect(calculateGreatCircleMiles(10.8188, 106.6519, 21.2212, null as any)).toBe(0);
  });
});
