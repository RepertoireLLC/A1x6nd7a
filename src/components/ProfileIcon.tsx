import { User } from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useModalStore } from '../store/modalStore';

export function ProfileIcon() {
  const [isOpen, setIsOpen] = useState(false);
  const currentUser = useAuthStore((state) => state.user);
  const { setProfileUserId } = useModalStore();

  if (!currentUser) return null;

  return (
    <div className="absolute top-4 right-36 z-10">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 bg-white/10 backdrop-blur-md border border-white/10 rounded-lg text-white hover:bg-white/20 transition-colors flex items-center space-x-2"
      >
        {currentUser.profilePicture ? (
          <img
            src={currentUser.profilePicture}
            alt={currentUser.name}
            className="w-5 h-5 rounded-full object-cover"
          />
        ) : (
          <User className="w-5 h-5" />
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white/10 backdrop-blur-md border border-white/10 rounded-lg overflow-hidden">
          <button
            onClick={() => {
              setProfileUserId(currentUser.id);
              setIsOpen(false);
            }}
            className="w-full px-4 py-2 text-left text-white hover:bg-white/10 transition-colors"
          >
            View Profile
          </button>
          <button
            onClick={() => {
              setProfileUserId(currentUser.id);
              setIsOpen(false);
            }}
            className="w-full px-4 py-2 text-left text-white hover:bg-white/10 transition-colors"
          >
            Edit Profile
          </button>
        </div>
      )}
    </div>
  );
}