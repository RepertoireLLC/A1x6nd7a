import { create } from 'zustand';

interface Message {
  id: string;
  fromUserId: string;
  toUserId: string;
  content: string;
  timestamp: number;
}

interface ChatState {
  activeChat: string | null;
  messages: Message[];
  setActiveChat: (userId: string | null) => void;
  sendMessage: (fromUserId: string, toUserId: string, content: string) => void;
  getMessagesForChat: (userId1: string, userId2: string) => Message[];
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeChat: null,
  messages: [],
  
  setActiveChat: (userId) => set({ activeChat: userId }),
  
  sendMessage: (fromUserId, toUserId, content) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      fromUserId,
      toUserId,
      content,
      timestamp: Date.now(),
    };
    
    set((state) => ({
      messages: [...state.messages, newMessage],
    }));
  },
  
  getMessagesForChat: (userId1, userId2) => {
    return get().messages.filter(
      (msg) =>
        (msg.fromUserId === userId1 && msg.toUserId === userId2) ||
        (msg.fromUserId === userId2 && msg.toUserId === userId1)
    ).sort((a, b) => a.timestamp - b.timestamp);
  },
}));