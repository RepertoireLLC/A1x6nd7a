import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import { useUserStore } from '../store/userStore';
import { useAuthStore } from '../store/authStore';
import { useModalStore } from '../store/modalStore';
import * as THREE from 'three';

export function UserNodes() {
  const users = useUserStore((state) => state.users);
  const currentUser = useAuthStore((state) => state.user);
  const setProfileUserId = useModalStore((state) => state.setProfileUserId);
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.001;
    }
  });

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.rotation.x = Math.PI * 0.1;
    }
  }, []);

  const onlineUsers = users.filter(user => user.online);
  const radius = 3;
  const nodeRadius = 0.2;

  return (
    <group ref={groupRef}>
      {onlineUsers.map((user, index) => {
        const goldenRatio = (1 + Math.sqrt(5)) / 2;
        const i = index + 1;
        const phi = Math.acos(1 - (2 * i) / onlineUsers.length);
        const theta = 2 * Math.PI * i / goldenRatio;

        const x = radius * Math.sin(phi) * Math.cos(theta);
        const y = radius * Math.sin(phi) * Math.sin(theta);
        const z = radius * Math.cos(phi);

        const isCurrentUser = currentUser?.id === user.id;

        return (
          <group key={user.id} position={[x, y, z]}>
            <mesh
              onClick={() => setProfileUserId(user.id)}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                document.body.style.cursor = 'default';
              }}
            >
              <sphereGeometry args={[nodeRadius, 32, 32]} />
              <meshStandardMaterial
                color={user.color}
                emissive={user.color}
                emissiveIntensity={isCurrentUser ? 0.8 : 0.5}
              />
            </mesh>
            <Billboard>
              <group>
                <Text
                  position={[0, nodeRadius * 2, 0]}
                  fontSize={0.2}
                  color={user.color}
                  anchorX="center"
                  anchorY="middle"
                >
                  {user.name}
                </Text>
                <mesh position={[user.name.length * 0.05 + 0.2, nodeRadius * 2, 0]}>
                  <sphereGeometry args={[0.04, 16, 16]} />
                  <meshBasicMaterial color="#10b981" />
                  <pointLight
                    color="#10b981"
                    intensity={0.5}
                    distance={0.5}
                  />
                </mesh>
              </group>
            </Billboard>
          </group>
        );
      })}
    </group>
  );
}