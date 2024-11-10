import { useUserStore } from './userStore';
import { useAuthStore } from './authStore';

// Helper function to get random position on a sphere
function getRandomSpherePosition(radius: number = 3): [number, number, number] {
  const theta = Math.random() * Math.PI * 2; // Azimuthal angle
  const phi = Math.acos(2 * Math.random() - 1); // Polar angle
  return [
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
  ];
}

export function initializeMockData() {
  const addUser = useUserStore.getState().addUser;
  const setOnlineStatus = useUserStore.getState().setOnlineStatus;
  const updateUserPosition = useUserStore.getState().updateUserPosition;
  const currentUser = useAuthStore.getState().user;
  const registeredUsers = useAuthStore.getState().registeredUsers;

  // Add current user to the sphere
  if (currentUser) {
    addUser({
      ...currentUser,
      position: getRandomSpherePosition(),
      online: true,
    });
    setOnlineStatus(currentUser.id, true);
    updateUserPosition(currentUser.id, getRandomSpherePosition());
  }

  // Add all registered users except current user
  registeredUsers
    .filter(user => user.id !== currentUser?.id)
    .forEach(user => {
      addUser({
        ...user,
        position: getRandomSpherePosition(),
        online: false,
      });
      updateUserPosition(user.id, getRandomSpherePosition());
    });
}