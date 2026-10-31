import * as ImagePicker from 'expo-image-picker';
import { Paperclip, Send, X } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Sheet } from '@/components/ui/Sheet';
import { submitFeedback } from '@/lib/social';
import { notify } from '@/store/notify';
import { Void } from '@/theme/tokens';

interface Attachment { uri: string; type: string }

export function FeedbackModal({ visible, userId, onClose }: {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);

  const reset = () => { setMessage(''); setAttachments([]); setSending(false); };

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { notify('Permission needed', { body: 'Allow photo library access to attach screenshots.', tone: 'error' }); return; }
    let result;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: 4,
        quality: 0.8,
        allowsEditing: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
    } catch (e) {
      console.warn('[FeedbackModal pick]', e);
      notify('Could not read attachment', { body: 'That file could not be loaded. Try another one.', tone: 'error' });
      return;
    }
    if (!result.canceled) {
      setAttachments((prev) => [
        ...prev,
        ...result.assets.map((a) => ({ uri: a.uri, type: a.type === 'video' ? 'video' : 'image' })),
      ].slice(0, 4));
    }
  };

  const send = async () => {
    if (!message.trim()) { notify('Empty', { body: 'Write something first.', tone: 'error' }); return; }
    setSending(true);
    try {
      const res = await submitFeedback(userId, { message, attachmentUris: attachments });
      if (res.ok) {
        reset();
        onClose();
        notify('Sent', { body: 'Thanks - straight to Andy.', tone: 'success' });
      } else {
        setSending(false);
        notify('Failed', { body: res.error ?? 'Could not send feedback.', tone: 'error' });
      }
    } catch (e) {
      setSending(false);
      notify('Failed', { body: e instanceof Error ? e.message : 'Could not send feedback.', tone: 'error' });
    }
  };

  // Closing via X/back wipes the draft so it doesn't linger into next open.
  const close = () => {
    reset();
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={close} title="FEEDBACK" style={{ maxHeight: '80%' }}>
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
            <TextInput
              style={s.input}
              placeholder="Bug, idea, complaint - tell me everything."
              placeholderTextColor={Void.textTertiary}
              multiline
              value={message}
              onChangeText={setMessage}
            />
            {attachments.length > 0 && (
              <View style={s.attachRow}>
                {attachments.map((a, i) => (
                  <View key={i} style={s.attach}>
                    {a.type === 'image'
                      ? <Image source={{ uri: a.uri }} style={s.attachImg} />
                      : <View style={[s.attachImg, s.attachVideo]}><Text style={s.attachVideoText}>VIDEO</Text></View>}
                    <Pressable style={s.attachX} onPress={() => setAttachments((p) => p.filter((_, j) => j !== i))} hitSlop={6}>
                      <X color="#fff" size={12} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            <Pressable style={s.attachBtn} onPress={() => void pick()}>
              <Paperclip color={Void.accent} size={14} />
              <Text style={s.attachBtnText}>{attachments.length > 0 ? `ATTACH MORE (${attachments.length}/4)` : 'ADD SCREENSHOTS / VIDEO'}</Text>
            </Pressable>
          </ScrollView>
          <Pressable style={[s.send, (!message.trim() || sending) && { opacity: 0.4 }]} disabled={!message.trim() || sending} onPress={() => void send()}>
            <Send color={Void.accentText} size={14} />
            <Text style={s.sendText}>{sending ? 'SENDING...' : 'SEND'}</Text>
          </Pressable>
    </Sheet>
  );
}

const s = StyleSheet.create({
  input: { color: Void.text, fontSize: 15, minHeight: 100, textAlignVertical: 'top', backgroundColor: Void.canvas, borderRadius: 10, borderWidth: 1, borderColor: Void.border, padding: 12 },
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  attach: { position: 'relative' },
  attachImg: { width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderColor: Void.border },
  attachVideo: { backgroundColor: Void.canvas, alignItems: 'center', justifyContent: 'center' },
  attachVideoText: { color: Void.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  attachX: { position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: Void.danger, alignItems: 'center', justifyContent: 'center' },
  attachBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingVertical: 8 },
  attachBtnText: { color: Void.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  send: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Void.accent, borderRadius: 10, paddingVertical: 12, marginTop: 8 },
  sendText: { color: Void.accentText, fontSize: 13, fontWeight: '900', letterSpacing: 1.5 },
});


