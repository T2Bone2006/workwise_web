/**
 * Real UK postcodes with lat/lng for seeding workers across regions.
 * Used only for dev/seed data; no external API calls.
 */
export const UK_SEED_POSTCODES: { postcode: string; lat: number; lng: number }[] = [
  { postcode: 'SW1A 1AA', lat: 51.5014, lng: -0.1419 },   // London Westminster
  { postcode: 'E1 6AN', lat: 51.5155, lng: -0.0722 },      // London Shoreditch
  { postcode: 'NW1 2DB', lat: 51.5392, lng: -0.1426 },    // London Camden
  { postcode: 'SE1 9SG', lat: 51.5045, lng: -0.0865 },    // London Southwark
  { postcode: 'W1A 1AB', lat: 51.5074, lng: -0.1278 },   // London West End
  { postcode: 'M1 1AD', lat: 53.4808, lng: -2.2426 },     // Manchester
  { postcode: 'M4 1AE', lat: 53.4860, lng: -2.2300 },     // Manchester Salford
  { postcode: 'B1 1AA', lat: 52.4862, lng: -1.8904 },     // Birmingham
  { postcode: 'B5 4BD', lat: 52.4637, lng: -1.8860 },     // Birmingham Digbeth
  { postcode: 'LS1 1UR', lat: 53.7960, lng: -1.5456 },    // Leeds
  { postcode: 'L1 1JQ', lat: 53.4084, lng: -2.9916 },     // Liverpool
  { postcode: 'G1 1AA', lat: 55.8611, lng: -4.2500 },     // Glasgow
  { postcode: 'S1 1HJ', lat: 53.3830, lng: -1.4649 },    // Sheffield
  { postcode: 'BS1 1TR', lat: 51.4545, lng: -2.5879 },    // Bristol
  { postcode: 'NE1 4ST', lat: 54.9783, lng: -1.6178 },    // Newcastle
  { postcode: 'NG1 1HF', lat: 52.9548, lng: -1.1581 },    // Nottingham
  { postcode: 'CV1 1GS', lat: 52.4068, lng: -1.5197 },    // Coventry
  { postcode: 'LE1 1FJ', lat: 52.6369, lng: -1.1398 },   // Leicester
  { postcode: 'HU1 1RA', lat: 53.7443, lng: -0.3325 },   // Hull
  { postcode: 'SO14 0YN', lat: 50.9097, lng: -1.4044 },  // Southampton
  { postcode: 'PL1 1AA', lat: 50.3715, lng: -4.1423 },    // Plymouth
  { postcode: 'NR1 1UE', lat: 52.6309, lng: 1.2974 },     // Norwich
  { postcode: 'WA1 1BL', lat: 53.3894, lng: -2.5963 },    // Warrington
  { postcode: 'OL1 1BD', lat: 53.5444, lng: -2.1169 },   // Oldham
  { postcode: 'BD1 1AH', lat: 53.7960, lng: -1.7594 },   // Bradford
  { postcode: 'PR1 1AA', lat: 53.7632, lng: -2.7030 },   // Preston
  { postcode: 'OX1 1AZ', lat: 51.7520, lng: -1.2577 },   // Oxford
  { postcode: 'CB1 1AB', lat: 52.2053, lng: 0.1218 },     // Cambridge
  { postcode: 'MK1 1BB', lat: 52.0406, lng: -0.7594 },   // Milton Keynes
  { postcode: 'RG1 1AG', lat: 51.4543, lng: -0.9781 },   // Reading
  { postcode: 'BN1 1AE', lat: 50.8225, lng: -0.1372 },   // Brighton
  { postcode: 'CT1 1AH', lat: 51.2787, lng: 1.0797 },    // Canterbury
  { postcode: 'DY1 1AA', lat: 52.5123, lng: -2.0876 },   // Dudley
  { postcode: 'WV1 1AA', lat: 52.5862, lng: -2.1298 },   // Wolverhampton
  { postcode: 'ST1 1AA', lat: 53.0258, lng: -2.1754 },   // Stoke-on-Trent
  { postcode: 'DE1 1AA', lat: 52.9225, lng: -1.4746 },   // Derby
  { postcode: 'WR1 1AA', lat: 52.1920, lng: -2.2200 },   // Worcester
  { postcode: 'GL1 1AA', lat: 51.8642, lng: -2.2381 },   // Gloucester
  { postcode: 'EX1 1AA', lat: 50.7184, lng: -3.5339 },   // Exeter
  { postcode: 'TQ1 1AA', lat: 50.4619, lng: -3.5253 },   // Torbay
];

export function getRandomPostcode(): (typeof UK_SEED_POSTCODES)[number] {
  return UK_SEED_POSTCODES[Math.floor(Math.random() * UK_SEED_POSTCODES.length)]!;
}
