import { Search } from 'lucide-react';
import { useState } from 'react';
import { useUserStore } from '../store/userStore';
import { useModalStore } from '../store/modalStore';

export function SearchBar() {
  const [query, setQuery] = useState('');
  const users = useUserStore((state) => state.users);
  const setProfileUserId = useModalStore((state) => state.setProfileUserId);

  const filteredUsers = users.filter((user) =>
    user.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 w-full max-w-md z-10">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users..."
          className="w-full px-4 py-2 pl-10 bg-white/10 backdrop-blur-md border border-white/10 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-white/30"
        />
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
      </div>

      {query && (
        <div className="absolute w-full mt-2 bg-white/10 backdrop-blur-md border border-white/10 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
          {filteredUsers.length > 0 ? (
            filteredUsers.map((user) => (
              <button
                key={user.id}
                onClick={() => {
                  setProfileUserId(user.id);
                  setQuery('');
                }}
                className="w-full px-4 py-2 flex items-center space-x-3 hover:bg-white/10 transition-colors"
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: user.color }}
                >
                  <span className="text-white text-sm">{user.name[0].toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white">{user.name}</span>
                  <span className={`text-sm ${user.online ? 'text-emerald-400' : 'text-white/50'}`}>
                    • {user.online ? 'Online' : 'Offline'}
                  </span>
                  {user.online && (
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  )}
                </div>
              </button>
            ))
          ) : (
            <div className="px-4 py-2 text-white/50">No users found</div>
          )}
        </div>
      )}
    </div>
  );
}