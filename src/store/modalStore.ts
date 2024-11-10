import { create } from 'zustand';

interface ModalState {
  profileUserId: string | null;
  setProfileUserId: (userId: string | null) => void;
}

export const useModalStore = create<ModalState>((set) => ({
  profileUserId: null,
  setProfileUserId: (userId) => set({ profileUserId: userId }),
}));