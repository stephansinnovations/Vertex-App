import React, { useRef } from 'react';
import { useShortcut } from '@/lib/ShortcutContext';
import { useNavigate } from 'react-router-dom';

/**
 * Wraps a row and detects a 600ms long-press.
 * On long-press: stores { label, icon, path } as pending shortcut and navigates home.
 * On tap: calls onClick normally.
 *
 * Props:
 *   label, icon, path  — shortcut metadata
 *   onClick            — normal click handler
 *   className          — styling
 *   innerRef           — for @hello-pangea/dnd Draggable ref forwarding
 *   dragHandleProps    — spread onto the container for dnd
 *   children
 */
export default function LongPressRow({
  label, icon, path, onClick,
  className = '', style, children,
  innerRef, dragHandleProps,
}) {
  const { setPending } = useShortcut();
  const navigate = useNavigate();
  const timerRef = useRef(null);
  const didLongPress = useRef(false);

  const start = () => {
    didLongPress.current = false;
    timerRef.current = setTimeout(() => {
      didLongPress.current = true;
      setPending({ label, icon, path });
      navigate('/');
    }, 600);
  };

  const cancel = () => clearTimeout(timerRef.current);

  const handleClick = (e) => {
    if (didLongPress.current) return;
    onClick?.(e);
  };

  return (
    <div
      ref={innerRef}
      {...(dragHandleProps || {})}
      className={className}
      style={style}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onClick={handleClick}
    >
      {children}
    </div>
  );
}