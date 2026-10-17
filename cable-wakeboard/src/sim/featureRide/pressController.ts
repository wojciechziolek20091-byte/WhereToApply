import { DT } from '../config';
import type { InputMemory } from '../input';
import { approach } from '../math/scalar';
import type { JibState } from '../rider';
import type { SimState } from '../world';
import { isBoardslide } from './slideController';

/**
 * PressController (feature riding spec 5.5): W held on a 50-50 (or switch
 * 50-50) is a nose press, S a tail press. The board pitches up to
 * Press.Pitch onto one end; the fore-aft balance leans that way and its
 * window narrows the longer it is held, so the rider has to let go before
 * the meter runs out. A W/S tap in the last Press.EndTapZone of the feature
 * is a nose / tail tap (a small bonus).
 */

/** One tick of presses. `remaining` is the feature left ahead (m). */
export function stepPress(s: SimState, j: JibState, mem: InputMemory, remaining: number): void {
  const { cfg } = s;
  const P = cfg.featureRide.Press;
  // Presses are on 50-50s with the board settled; a W/S tap is not a press.
  const can = !isBoardslide(j.boardAngle) && j.boardAngle === j.targetAngle;
  const want = can && mem.foreDir !== 0 && mem.foreHeldTime >= cfg.feature.tapTime ? mem.foreDir : 0;
  if (want !== j.press) {
    j.press = want;
    j.pressTime = 0;
  }
  if (j.press !== 0) j.pressTime += DT;
  j.pressAmount = approach(j.pressAmount, j.press, DT / P.RampTime);
  if (j.pressAmount >= 0.5) j.pressTimes.nose += DT;
  else if (j.pressAmount <= -0.5) j.pressTimes.tail += DT;
  if (j.endTap === null && remaining <= P.EndTapZone && mem.foreTap !== 0 && !isBoardslide(j.boardAngle)) {
    j.endTap = mem.foreTap > 0 ? 'nose' : 'tail';
  }
}

/** Board pitch of the press (rad, + nose down onto the feature). */
export const pressPitch = (j: JibState, s: SimState): number => j.pressAmount * s.cfg.featureRide.Press.Pitch;
