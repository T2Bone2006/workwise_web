/** Hard ceiling on export rows regardless of requested scope, so one export can't pull the whole table unbounded. */
export const EXPORT_MAX_ROWS = 20000;
