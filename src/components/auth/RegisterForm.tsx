import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { UserPlus } from 'lucide-react';

export function RegisterForm({ onToggle }: { onToggle: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#' + Math.floor(Math.random()*16777215).toString(16));
  const [error, setError] = useState('');
  const register = useAuthStore((state) => state.register);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    const success = register({
      email,
      password,
      name: name || email.split('@')[0],
      color
    });

    if (!success) {
      setError('Email already registered');
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl shadow-xl">
      <div className="flex items-center justify-center mb-8">
        <div className="p-3 rounded-full bg-white/20">
          <UserPlus className="w-6 h-6 text-white" />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-white text-center mb-8">Create Account</h2>
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
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display Name (optional)"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-white/30"
          />
        </div>
        <div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min. 6 characters)"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-white/30"
            required
            minLength={6}
          />
        </div>
        <div>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm Password"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-white/30"
            required
          />
        </div>
        <div>
          <label className="block text-white/80 mb-2">Choose your node color</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-full h-12 rounded-lg cursor-pointer"
          />
        </div>
        <button
          type="submit"
          className="w-full py-3 px-4 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
        >
          Sign Up
        </button>
      </form>
      <p className="mt-6 text-center text-white/60">
        Already have an account?{' '}
        <button
          onClick={onToggle}
          className="text-white hover:underline focus:outline-none"
        >
          Sign in
        </button>
      </p>
    </div>
  );
}