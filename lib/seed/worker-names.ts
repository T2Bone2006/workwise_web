/**
 * Random first/last names for seeding workers. UK-style names.
 */
const FIRST = [
  'James', 'Oliver', 'George', 'Noah', 'Jack', 'Arthur', 'Charlie', 'Harry',
  'William', 'Thomas', 'Ethan', 'Leo', 'Henry', 'Oscar', 'Muhammad', 'Archie',
  'Olivia', 'Amelia', 'Isla', 'Ava', 'Mia', 'Isabella', 'Lily', 'Freya',
  'Emily', 'Sophia', 'Grace', 'Florence', 'Ella', 'Charlotte', 'Aria',
];
const LAST = [
  'Smith', 'Jones', 'Williams', 'Taylor', 'Brown', 'Davies', 'Evans', 'Wilson',
  'Thomas', 'Johnson', 'Roberts', 'Robinson', 'Wright', 'Thompson', 'White',
  'Hughes', 'Edwards', 'Green', 'Hall', 'Wood', 'Harris', 'Martin', 'Clark',
  'Lewis', 'James', 'Phillips', 'Walker', 'King', 'Patel', 'Campbell',
];

export function randomSeedName(): string {
  const first = FIRST[Math.floor(Math.random() * FIRST.length)]!;
  const last = LAST[Math.floor(Math.random() * LAST.length)]!;
  return `${first} ${last}`;
}
