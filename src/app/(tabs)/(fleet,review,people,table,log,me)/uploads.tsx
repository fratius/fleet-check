import { Screen } from '@/components/ui';
import { UploadList } from '@/components/uploads';

/** Photos and videos on their way from this phone (lib/outbox.ts), opened from the strip above the tab bar. */
export default function UploadsScreen() {
  return (
    <Screen edges={[]}>
      <UploadList />
    </Screen>
  );
}
