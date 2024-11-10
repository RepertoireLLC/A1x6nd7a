import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Sphere } from './Sphere';
import { UserNodes } from './UserNodes';
import { Suspense } from 'react';
import { useThemeStore } from '../store/themeStore';

export function Scene() {
  const currentTheme = useThemeStore((state) => state.currentTheme);

  const getFogColor = () => {
    switch (currentTheme) {
      case 'neon':
        return '#000B14';
      case 'galaxy':
        return '#0A001F';
      case 'matrix':
        return '#001100';
      case 'minimal':
        return '#1a1a1a';
      default:
        return '#0F172A';
    }
  };

  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [0, 0, 10], fov: 50 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={[getFogColor()]} />
        <fog attach="fog" args={[getFogColor(), 5, 20]} />
        
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        
        <Suspense fallback={null}>
          <Sphere />
          <UserNodes />
          {currentTheme === 'galaxy' && <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />}
        </Suspense>

        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          rotateSpeed={0.5}
          minDistance={5}
          maxDistance={15}
        />
      </Canvas>
    </div>
  );
}