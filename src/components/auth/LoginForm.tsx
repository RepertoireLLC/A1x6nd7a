import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { LogIn } from 'lucide-react';

export function LoginForm({ onToggle }: { onToggle: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const login = useAuthStore((state) => state.login);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const success = login({ email, password });
    
    if (!success) {
      setError('Invalid email or password');
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl shadow-xl">
      <div className="flex items-center justify-center mb-8">
        <div className="p-3 rounded-full bg-white/20">
          <LogIn className="w-6 h-6 text-white" />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-white text-center mb-8">Welcome Back</h2>
      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-white/30"
            required
          />
        </div>
        <div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-white/30"
            required
          />
        </div>
        <button
          type="submit"
          className="w-full py-3 px-4 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
        >
          Sign In
        </button>
      </form>
      <p className="mt-6 text-center text-white/60">
        Don't have an account?{' '}
        <button
          onClick={onToggle}
          className="text-white hover:underline focus:outline-none"
        >
          Sign up
        </button>
      </p>
    </div>
  );
}