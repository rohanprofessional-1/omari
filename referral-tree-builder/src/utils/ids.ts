let counter = 1;

export const generateId = (prefix: string): string =>
  `${prefix}${counter++}_${Math.random().toString(36).slice(2, 6)}`;

export const resetIdCounter = () => { counter = 1; };
