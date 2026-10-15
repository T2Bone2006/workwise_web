/** custom_fields.rounds.service_name, else job_description, else 'Visit'. */
export function visitServiceTitle(job: {
  custom_fields?: unknown;
  job_description?: string | null;
}): string {
  const cf = job.custom_fields;
  if (cf && typeof cf === 'object' && !Array.isArray(cf)) {
    const rounds = (cf as { rounds?: unknown }).rounds;
    if (rounds && typeof rounds === 'object' && !Array.isArray(rounds)) {
      const name = (rounds as { service_name?: unknown }).service_name;
      if (typeof name === 'string' && name.trim() !== '') return name.trim();
    }
  }
  if (typeof job.job_description === 'string' && job.job_description.trim() !== '') {
    return job.job_description.trim();
  }
  return 'Visit';
}
