import { useState, useEffect, useRef } from 'react';
import { X, Send } from 'lucide-react';
import { useChatStore } from '../../store/chatStore';
import { useUserStore } from '../../store/userStore';
import { useAuthStore } from '../../store/authStore';

interface ChatWindowProps {
  userId: string;
  onClose: () => void;
}

export function ChatWindow({ userId, onClose }: ChatWindowProps) {
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentUser = useAuthStore((state) => state.user);
  const otherUser = useUserStore((state) => state.users.find(u => u.id === userId));
  const { sendMessage, getMessagesForChat } = useChatStore();

  const messages = currentUser 
    ? getMessagesForChat(currentUser.id, userId)
    : [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !currentUser) return;

    sendMessage(currentUser.id, userId, message.trim());
    setMessage('');
  };

  if (!currentUser || !otherUser) return null;

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-white/10 backdrop-blur-md rounded-xl shadow-xl flex flex-col overflow-hidden">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div
            className="w-8 h-8 rounded-full"
            style={{ backgroundColor: otherUser.color }}
          />
          <span className="text-white font-medium">{otherUser.name}</span>
        </div>
        <button
          onClick={onClose}
          className="text-white/60 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-96">
        {messages.map((msg) => {
          const isOwn = msg.fromUserId === currentUser.id;
          return (
            <div
              key={msg.id}
              className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] p-3 rounded-lg ${
                  isOwn
                    ? 'bg-white/20 text-white'
                    : 'bg-white/10 text-white'
                }`}
              >
                {msg.content}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-white/10">
        <div className="flex space-x-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-white/30"
          />
          <button
            type="submit"
            className="p-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
}