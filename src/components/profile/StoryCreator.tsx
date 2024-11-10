import { useState, useRef } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useAuthStore } from '../../store/authStore';
import { Image, X } from 'lucide-react';

interface StoryCreatorProps {
  onClose: () => void;
}

export function StoryCreator({ onClose }: StoryCreatorProps) {
  const [content, setContent] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addStory = useStoryStore((state) => state.addStory);
  const currentUser = useAuthStore((state) => state.user);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentUser && content.trim()) {
      addStory(currentUser.id, content.trim(), imagePreview || undefined);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm z-50">
      <div className="w-full max-w-md p-6 bg-white/10 backdrop-blur-md rounded-xl shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-white">Create Story</h3>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What's on your mind?"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-white/30 resize-none"
            rows={4}
          />

          {imagePreview ? (
            <div className="relative">
              <img
                src={imagePreview}
                alt="Story preview"
                className="w-full rounded-lg"
              />
              <button
                type="button"
                onClick={() => setImagePreview(null)}
                className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white/60 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-12 border-2 border-dashed border-white/10 rounded-lg text-white/60 hover:text-white hover:border-white/30 transition-colors"
            >
              <Image className="w-8 h-8 mx-auto mb-2" />
              <span>Add an image</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="hidden"
          />

          <button
            type="submit"
            disabled={!content.trim()}
            className="w-full py-3 px-4 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Share Story
          </button>
        </form>
      </div>
    </div>
  );
}