'use client';

import { createContext, useContext } from 'react';

export type Look = 'new' | 'classic';

const LookContext = createContext<Look>('classic');

export const LookProvider = LookContext.Provider;

/** 'new' for Rounds and Lite logins, 'classic' for Pro. Set by the dashboard shell. */
export function useLook(): Look {
  return useContext(LookContext);
}
