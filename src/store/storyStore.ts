import { create } from 'zustand';

export interface Story {
  id: string;
  userId: string;
  content: string;
  image?: string;
  createdAt: number;
  expiresAt: number; // 24 hours after creation
}

interface StoryState {
  stories: Story[];
  addStory: (userId: string, content: string, image?: string) => void;
  removeStory: (storyId: string) => void;
  getActiveStoriesForUser: (userId: string) => Story[];
}

export const useStoryStore = create<StoryState>((set, get) => ({
  stories: [],
  
  addStory: (userId, content, image) => {
    const now = Date.now();
    const newStory: Story = {
      id: now.toString(),
      userId,
      content,
      image,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000, // 24 hours
    };
    
    set((state) => ({
      stories: [...state.stories, newStory],
    }));
  },
  
  removeStory: (storyId) => {
    set((state) => ({
      stories: state.stories.filter((story) => story.id !== storyId),
    }));
  },
  
  getActiveStoriesForUser: (userId) => {
    const now = Date.now();
    return get().stories.filter(
      (story) => story.userId === userId && story.expiresAt > now
    );
  },
}));