import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, F, T, useColors } from '@/components/ui';
import { LANGS, t } from '@/lib/i18n';
import { useLang } from '@/lib/lang';

/** The list of languages, each in its own name, with the phone's language first. */
function LanguageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useColors();
  const l = useLang();
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (code: string | null) => {
    setBusy(code || 'device');
    try { await l.choose(code); } finally { setBusy(null); onClose(); }
  };
  const dev = LANGS.find((x) => x.code === l.device);
  const row = (key: string, code: string | null, title: string, sub: string, on: boolean) => (
    <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: on }} disabled={!!busy} onPress={() => pick(code)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1,
        borderColor: c.rule, backgroundColor: on ? c.ink : pressed ? c.page : c.paper })}>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontFamily: F.cond, fontSize: 21, color: on ? c.paper : c.ink }}>{title}</Text>
        <Text style={{ fontFamily: F.body, fontSize: 13, color: on ? c.paper : c.ink2 }}>{sub}</Text>
      </View>
      {busy === (code || 'device') ? <Text style={{ fontFamily: F.medium, color: on ? c.paper : c.ink2 }}>…</Text> : null}
    </Pressable>
  );
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: c.paper }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, borderBottomWidth: 2, borderColor: c.ink }}>
          <T v="h2" style={{ flex: 1 }}>{t('Language')}</T>
          <Button small title={t('Close')} onPress={onClose} />
        </View>
        <ScrollView>
          {row('device', null, t('Same as the phone'), dev ? `${dev.name} (${dev.english})` : 'English', !l.picked)}
          {LANGS.map((x) => row(x.code, x.code, x.name, x.english, l.picked === x.code))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/** Account tab: the language this person sees the app in. */
export function LanguageCard() {
  const l = useLang();
  const [open, setOpen] = useState(false);
  const cur = LANGS.find((x) => x.code === l.code);
  return (
    <Card>
      <T v="h3">{t('Language')}</T>
      <T v="body">{cur ? `${cur.name}${cur.code !== 'en' ? ` (${cur.english})` : ''}` : 'English'}{l.picked ? '' : `, ${t('as on the phone')}`}</T>
      <Button small title={t('Change language')} onPress={() => setOpen(true)} />
      <T v="small">{t('Your notifications come in this language too. Names, notes and what the AI wrote stay as they were written.')}</T>
      <LanguageSheet open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

/** A small link to change the language before signing in. */
export function LanguageLink() {
  const l = useLang();
  const [open, setOpen] = useState(false);
  const cur = LANGS.find((x) => x.code === l.code);
  return (
    <>
      <Button small v="link" title={`${t('Language')}: ${cur?.name || 'English'}`} onPress={() => setOpen(true)} style={{ alignSelf: 'flex-start' }} />
      <LanguageSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
