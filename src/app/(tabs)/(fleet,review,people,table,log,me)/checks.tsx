import { Card, Screen, T } from '@/components/ui';
import { RoutineList } from '@/components/routines';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** Checks for drivers: the list owners and fleet managers see and change (src/components/routines.tsx). */
export default function ChecksScreen() {
  const s = useSession();
  if (!s.staff) return <Screen edges={[]}><Card dashed><T v="hint">{t('Your fleet manager sets the checks.')}</T></Card></Screen>;
  if (s.mode !== 'firebase') return <Screen edges={[]}><Card dashed><T v="hint">{t('Checks for drivers need the Firebase backend.')}</T></Card></Screen>;
  return (
    <Screen edges={[]}>
      <RoutineList />
    </Screen>
  );
}
