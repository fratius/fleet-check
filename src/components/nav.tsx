import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { T } from '@/components/ui';

export function BackBar({ title, onPress }: { title: string; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${title}`} hitSlop={10}
      onPress={onPress || (() => (router.canGoBack() ? router.back() : router.replace('/')))} style={{ paddingVertical: 6, alignSelf: 'flex-start' }}>
      <T v="h3">‹ {title}</T>
    </Pressable>
  );
}
