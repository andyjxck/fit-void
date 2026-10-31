import { create } from 'zustand';

interface FolderState {
  version: number;
  bump: () => void;
}

export const useFolderStore = create<FolderState>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
