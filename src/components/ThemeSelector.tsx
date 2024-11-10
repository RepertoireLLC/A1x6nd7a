import { Palette } from 'lucide-react';
import { useState } from 'react';
import { useThemeStore, ThemeType } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useUserStore } from '../store/userStore';

const themes: { id: ThemeType; name: string }[] = [
  { id: 'classic', name: 'Classic' },
  { id: 'neon', name: 'Neon' },
  { id: 'galaxy', name: 'Galaxy' },
  { id: 'matrix', name: 'Matrix' },
  { id: 'minimal', name: 'Minimal' },
];

export function ThemeSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const { currentTheme, setTheme } = useThemeStore();
  const currentUser = useAuthStore((state) => state.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const { updateUserColor, setOnlineStatus } = useUserStore();

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (currentUser) {
      const newColor = e.target.value;
      updateProfile({ color: newColor });
      updateUserColor(currentUser.id, newColor);
      setOnlineStatus(currentUser.id, true);
    }
  };

  return (
    <div className="absolute top-4 right-20 z-10">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 bg-white/10 backdrop-blur-md border border-white/10 rounded-lg text-white hover:bg-white/20 transition-colors"
      >
        <Palette className="w-5 h-5" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white/10 backdrop-blur-md border border-white/10 rounded-lg overflow-hidden">
          {themes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => {
                setTheme(theme.id);
                setIsOpen(false);
              }}
              className={`w-full px-4 py-2 text-left hover:bg-white/10 transition-colors ${
                currentTheme === theme.id
                  ? 'text-white bg-white/20'
                  : 'text-white/80'
              }`}
            >
              {theme.name}
            </button>
          ))}
          
          <div className="border-t border-white/10">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="w-full px-4 py-2 text-left text-white/80 hover:bg-white/10 transition-colors"
            >
              Change Node Color
            </button>
            {showColorPicker && (
              <div className="px-4 py-2 bg-white/5">
                <input
                  type="color"
                  value={currentUser?.color || '#ffffff'}
                  onChange={handleColorChange}
                  className="w-full h-8 rounded cursor-pointer"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}