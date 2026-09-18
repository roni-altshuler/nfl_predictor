import type { Metadata } from 'next'
import { ForecastLab } from '@/components/forecast/ForecastLab'
import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { getLabData } from '@/lib/server/forecastLab'
export const dynamic = 'force-static'
export const metadata: Metadata = {title:'Forecast Lab',description:'Explore NFL matchups, key-number spreads and conditional playoff scenarios with published model probabilities.'}
export default function LabPage() {
  return <div className="space-y-8"><ForecastLab initial={getLabData()} /><EvidencePanel /></div>
}
