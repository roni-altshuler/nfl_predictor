"""Verify that a publication preserves every forecast in the restored warehouse."""
import argparse
import sqlite3
from pathlib import Path

COLUMNS = ('fixture_uid','generated_at','model_version','competition_id','season','week',
           'kickoff_utc','home_team','away_team','p_home','p_away','p_tie','exp_margin','exp_total')


def verify(previous, candidate):
    with sqlite3.connect(f'{Path(candidate).resolve().as_uri()}?mode=ro',uri=True) as conn:
        conn.execute('ATTACH DATABASE ? AS previous', (f'{Path(previous).resolve().as_uri()}?mode=ro',))
        columns = ','.join(COLUMNS)
        lost = conn.execute(f'SELECT {columns} FROM previous.prediction_snapshots EXCEPT '
                            f'SELECT {columns} FROM main.prediction_snapshots LIMIT 1').fetchone()
        if lost is not None:
            raise ValueError(f'Historical forecast missing or modified: {lost[:3]}')
        return conn.execute('SELECT COUNT(*) FROM prediction_snapshots').fetchone()[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--previous',required=True)
    parser.add_argument('--candidate',default='backend/data/warehouse.sqlite')
    args = parser.parse_args()
    print(f'Forecast history preserved: {verify(args.previous,args.candidate)} snapshots')

if __name__ == '__main__':
    main()
