import { DEFAULT_CONFIG, DT } from '../src/sim/config';
import { carveToEdge, toeSign, updateEdge } from '../src/sim/edge';

const cfg = DEFAULT_CONFIG.edge;
const rider = () => ({ stance: 'regular' as const, switchStance: false, edgeAngle: 0, heading: 0, connection: 1 });

describe('edge', () => {
  it('builds progressively, never faster than edgeBuildRate', () => {
    const r = rider();
    let prev = 0;
    for (let i = 0; i < 120; i++) {
      updateEdge(r, 1, cfg, DT);
      expect(r.edgeAngle - prev).toBeLessThanOrEqual(cfg.edgeBuildRate * DT + 1e-12);
      prev = r.edgeAngle;
    }
    expect(r.edgeAngle).toBeCloseTo(cfg.maxEdgeAngle, 9);
  });

  it('flattens faster than it loads', () => {
    const r = { ...rider(), edgeAngle: cfg.maxEdgeAngle };
    updateEdge(r, 0, cfg, DT);
    expect(cfg.maxEdgeAngle - r.edgeAngle).toBeCloseTo(cfg.edgeReleaseRate * DT, 9);
  });

  it('cannot hold a full edge when disconnected', () => {
    const r = { ...rider(), connection: 0 };
    for (let i = 0; i < 120; i++) updateEdge(r, 1, cfg, DT);
    expect(r.edgeAngle).toBeLessThan(cfg.maxEdgeAngle * 0.7);
  });

  it('maps stance and switch to the toe side', () => {
    expect(toeSign({ stance: 'regular', switchStance: false })).toBe(1);
    expect(toeSign({ stance: 'goofy', switchStance: false })).toBe(-1);
    expect(toeSign({ stance: 'regular', switchStance: true })).toBe(-1);
    // Regular rider's toes point right, so carving right is toeside.
    expect(carveToEdge({ stance: 'regular', switchStance: false }, 1)).toBe(-1);
  });
});
