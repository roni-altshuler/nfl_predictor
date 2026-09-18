import { NextResponse } from 'next/server'
import { getLabData } from '@/lib/server/forecastLab'
export const dynamic = 'force-dynamic'
export function GET() {
  const data = getLabData()
  return NextResponse.json(data,{status:data.unavailable?503:200,headers:{'Cache-Control':'no-store'}})
}
