import { useState } from 'react';
import { Story } from '../../store/storyStore';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface StoryViewerProps {
  stories: Story[];
}

export function StoryViewer({ stories }: StoryViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isViewing, setIsViewing] = useState(false);

  const handleNext = () => {
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setIsViewing(false);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  if (!isViewing) {
    return (
      <div className="flex space-x-2">
        {stories.map((story, index) => (
          <button
            key={story.id}
            onClick={() => {
              setCurrentIndex(index);
              setIsViewing(true);
            }}
            className="w-16 h-16 rounded-full border-2 border-white/30 p-0.5"
          >
            {story.image ? (
              <img
                src={story.image}
                alt="Story thumbnail"
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              <div className="w-full h-full rounded-full bg-white/10 flex items-center justify-center">
                <span className="text-white text-xs">Story</span>
              </div>
            )}
          </button>
        ))}
      </div>
    );
  }

  const currentStory = stories[currentIndex];

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
      <button
        onClick={() => setIsViewing(false)}
        className="absolute top-4 right-4 text-white/60 hover:text-white"
      >
        <X className="w-6 h-6" />
      </button>

      <button
        onClick={handlePrevious}
        className="absolute left-4 text-white/60 hover:text-white disabled:opacity-50"
        disabled={currentIndex === 0}
      >
        <ChevronLeft className="w-8 h-8" />
      </button>

      <div className="max-w-lg w-full mx-4">
        {currentStory.image && (
          <img
            src={currentStory.image}
            alt="Story"
            className="w-full rounded-lg"
          />
        )}
        <p className="text-white mt-4 text-center">{currentStory.content}</p>
      </div>

      <button
        onClick={handleNext}
        className="absolute right-4 text-white/60 hover:text-white disabled:opacity-50"
        disabled={currentIndex === stories.length - 1}
      >
        <ChevronRight className="w-8 h-8" />
      </button>
    </div>
  );
}