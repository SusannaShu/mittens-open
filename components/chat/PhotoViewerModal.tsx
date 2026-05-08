/**
 * PhotoViewerModal -- Full-screen photo viewer overlay.
 */

import React from 'react';
import { Modal, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

function resolvePhotoUri(photo: string): string {
  if (photo.startsWith('http')) return photo;
  if (photo.startsWith('file://') || photo.startsWith('/')) return photo;
  return `data:image/jpeg;base64,${photo}`;
}

interface PhotoViewerModalProps {
  photo: string | null;
  onClose: () => void;
}

export default function PhotoViewerModal({ photo, onClose }: PhotoViewerModalProps) {
  return (
    <Modal visible={!!photo} transparent animationType="fade">
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        {photo && (
          <Image
            source={{ uri: resolvePhotoUri(photo) }}
            style={styles.image}
            resizeMode="contain"
          />
        )}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Feather name="x" size={24} color="#FFF" />
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '90%',
    height: '70%',
  },
  closeBtn: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
