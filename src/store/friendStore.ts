import { create } from 'zustand';

interface FriendRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: 'pending' | 'accepted' | 'rejected';
}

interface FriendState {
  friendRequests: FriendRequest[];
  sendFriendRequest: (fromUserId: string, toUserId: string) => void;
  acceptFriendRequest: (requestId: string) => void;
  rejectFriendRequest: (requestId: string) => void;
  isFriend: (userId1: string, userId2: string) => boolean;
  hasPendingRequest: (fromUserId: string, toUserId: string) => boolean;
}

export const useFriendStore = create<FriendState>((set, get) => ({
  friendRequests: [],
  
  sendFriendRequest: (fromUserId, toUserId) => {
    const newRequest: FriendRequest = {
      id: Date.now().toString(),
      fromUserId,
      toUserId,
      status: 'pending',
    };
    
    set((state) => ({
      friendRequests: [...state.friendRequests, newRequest],
    }));
  },
  
  acceptFriendRequest: (requestId) => {
    set((state) => ({
      friendRequests: state.friendRequests.map((request) =>
        request.id === requestId
          ? { ...request, status: 'accepted' }
          : request
      ),
    }));
  },
  
  rejectFriendRequest: (requestId) => {
    set((state) => ({
      friendRequests: state.friendRequests.map((request) =>
        request.id === requestId
          ? { ...request, status: 'rejected' }
          : request
      ),
    }));
  },
  
  isFriend: (userId1, userId2) => {
    return get().friendRequests.some(
      (request) =>
        request.status === 'accepted' &&
        ((request.fromUserId === userId1 && request.toUserId === userId2) ||
         (request.fromUserId === userId2 && request.toUserId === userId1))
    );
  },
  
  hasPendingRequest: (fromUserId, toUserId) => {
    return get().friendRequests.some(
      (request) =>
        request.status === 'pending' &&
        request.fromUserId === fromUserId &&
        request.toUserId === toUserId
    );
  },
}));