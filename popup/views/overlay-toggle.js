import { state, rerender } from '../state.js';
import { setOverlay } from '../page.js';

/* Shared by Headings / Images / Links views. */
export async function toggleOverlay(mode, on) {
    try {
        state.overlay = await setOverlay(mode, on);
    } catch {
        state.overlay = [];
    }
    rerender();
}
