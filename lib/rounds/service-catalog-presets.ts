export type ServicePreset = {
  name: string;
  default_price: number;
  default_duration_minutes: number;
  default_frequency_days: number | null;
};

export const SERVICE_PRESETS: Record<
  'window_cleaning' | 'gardening' | 'cleaning' | 'exterior' | 'general',
  { label: string; services: ServicePreset[] }
> = {
  window_cleaning: {
    label: 'Window cleaning',
    services: [
      {
        name: 'Window clean (front)',
        default_price: 12,
        default_duration_minutes: 20,
        default_frequency_days: 28,
      },
      {
        name: 'Window clean (front & back)',
        default_price: 18,
        default_duration_minutes: 30,
        default_frequency_days: 28,
      },
      {
        name: 'Conservatory roof',
        default_price: 40,
        default_duration_minutes: 60,
        default_frequency_days: 91,
      },
      {
        name: 'Gutter clear',
        default_price: 60,
        default_duration_minutes: 60,
        default_frequency_days: 365,
      },
      {
        name: 'Fascia & soffit clean',
        default_price: 45,
        default_duration_minutes: 45,
        default_frequency_days: 365,
      },
      {
        name: 'Solar panel clean',
        default_price: 50,
        default_duration_minutes: 60,
        default_frequency_days: 182,
      },
    ],
  },
  gardening: {
    label: 'Gardening',
    services: [
      {
        name: 'Lawn cut',
        default_price: 25,
        default_duration_minutes: 45,
        default_frequency_days: 14,
      },
      {
        name: 'Hedge trim',
        default_price: 40,
        default_duration_minutes: 60,
        default_frequency_days: 56,
      },
      {
        name: 'Garden tidy',
        default_price: 35,
        default_duration_minutes: 60,
        default_frequency_days: 28,
      },
    ],
  },
  cleaning: {
    label: 'Cleaning',
    services: [
      {
        name: 'Oven clean',
        default_price: 55,
        default_duration_minutes: 90,
        default_frequency_days: 91,
      },
      {
        name: 'Carpet clean (room)',
        default_price: 35,
        default_duration_minutes: 60,
        default_frequency_days: 182,
      },
      {
        name: 'Domestic clean',
        default_price: 45,
        default_duration_minutes: 120,
        default_frequency_days: 7,
      },
    ],
  },
  exterior: {
    label: 'Exterior',
    services: [
      {
        name: 'Driveway pressure wash',
        default_price: 120,
        default_duration_minutes: 180,
        default_frequency_days: 365,
      },
      {
        name: 'Patio pressure wash',
        default_price: 90,
        default_duration_minutes: 120,
        default_frequency_days: 365,
      },
      {
        name: 'Wheelie bin clean',
        default_price: 5,
        default_duration_minutes: 10,
        default_frequency_days: 14,
      },
    ],
  },
  general: {
    label: 'General',
    services: [
      {
        name: 'Call-out',
        default_price: 40,
        default_duration_minutes: 60,
        default_frequency_days: null,
      },
      {
        name: 'Maintenance visit',
        default_price: 50,
        default_duration_minutes: 60,
        default_frequency_days: 28,
      },
    ],
  },
};
