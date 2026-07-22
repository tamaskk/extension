'use client';
import { create } from 'zustand';

export interface Me {
  id: string; email: string; name: string; role: string;
  verified?: boolean; onboarded?: boolean; referralCode?: string; plan?: string | null;
}

interface AppState {
  me: Me | null;
  balance: number;
  loaded: boolean;
  buyOpen: boolean;          // global purchase modal (opened on 402 or manually)
  setAuth: (me: Me | null, balance: number) => void;
  setBalance: (b: number) => void;
  setBuyOpen: (open: boolean) => void;
  clear: () => void;
}

export const useApp = create<AppState>((set) => ({
  me: null,
  balance: 0,
  loaded: false,
  buyOpen: false,
  setAuth: (me, balance) => set({ me, balance, loaded: true }),
  setBalance: (balance) => set({ balance }),
  setBuyOpen: (buyOpen) => set({ buyOpen }),
  clear: () => set({ me: null, balance: 0, loaded: true }),
}));
