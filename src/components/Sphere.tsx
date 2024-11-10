import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Mesh, Color, MathUtils } from 'three';
import { useThemeStore } from '../store/themeStore';

const themeConfigs = {
  classic: {
    sphereColor: '#2563eb',
    wireframe: true,
    opacity: 0.15,
    emissive: '#1d4ed8',
    rotationSpeed: 0.001,
    segments: 64,
    pulseIntensity: 0.1,
    pulseSpeed: 1,
  },
  neon: {
    sphereColor: '#00ff99',
    wireframe: true,
    opacity: 0.2,
    emissive: '#00ff99',
    rotationSpeed: 0.002,
    segments: 48,
    pulseIntensity: 0.3,
    pulseSpeed: 2,
  },
  galaxy: {
    sphereColor: '#9333ea',
    wireframe: false,
    opacity: 0.5,
    emissive: '#7e22ce',
    rotationSpeed: 0.0015,
    segments: 96,
    pulseIntensity: 0.2,
    pulseSpeed: 0.5,
  },
  matrix: {
    sphereColor: '#22c55e',
    wireframe: true,
    opacity: 0.3,
    emissive: '#16a34a',
    rotationSpeed: 0.003,
    segments: 32,
    pulseIntensity: 0.4,
    pulseSpeed: 3,
  },
  minimal: {
    sphereColor: '#e2e8f0',
    wireframe: true,
    opacity: 0.1,
    emissive: '#94a3b8',
    rotationSpeed: 0.0005,
    segments: 24,
    pulseIntensity: 0.05,
    pulseSpeed: 0.5,
  },
};

export function Sphere() {
  const sphereRef = useRef<Mesh>(null);
  const currentTheme = useThemeStore((state) => state.currentTheme);
  const config = themeConfigs[currentTheme];

  useFrame(({ clock }) => {
    if (sphereRef.current) {
      const time = clock.getElapsedTime();
      
      // Base rotation
      sphereRef.current.rotation.y += config.rotationSpeed;
      
      // Theme-specific animations
      switch (currentTheme) {
        case 'neon':
          sphereRef.current.material.emissiveIntensity = 
            0.5 + Math.sin(time * config.pulseSpeed) * config.pulseIntensity;
          sphereRef.current.rotation.z = Math.sin(time * 0.5) * 0.1;
          break;
          
        case 'galaxy':
          sphereRef.current.rotation.z = Math.sin(time * 0.3) * 0.2;
          sphereRef.current.material.emissiveIntensity = 
            0.3 + Math.sin(time * 0.5) * 0.2;
          break;
          
        case 'matrix':
          sphereRef.current.scale.y = 
            1 + Math.sin(time * config.pulseSpeed) * 0.05;
          sphereRef.current.material.emissiveIntensity =
            0.4 + Math.sin(time * 3) * 0.2;
          break;
          
        case 'minimal':
          sphereRef.current.rotation.x = Math.sin(time * 0.2) * 0.1;
          break;
          
        default:
          sphereRef.current.scale.setScalar(
            1 + Math.sin(time * config.pulseSpeed) * 0.03
          );
      }

      // Smooth color transitions
      const targetColor = new Color(config.sphereColor);
      const currentColor = sphereRef.current.material.color;
      currentColor.lerp(targetColor, 0.1);
      
      const targetEmissive = new Color(config.emissive);
      const currentEmissive = sphereRef.current.material.emissive;
      currentEmissive.lerp(targetEmissive, 0.1);
    }
  });

  return (
    <mesh ref={sphereRef}>
      <sphereGeometry args={[3, config.segments, config.segments]} />
      <meshPhongMaterial
        color={new Color(config.sphereColor)}
        wireframe={config.wireframe}
        transparent
        opacity={config.opacity}
        emissive={new Color(config.emissive)}
        emissiveIntensity={0.3}
        wireframeLinewidth={2}
      />
    </mesh>
  );
}