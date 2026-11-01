import { Check, ChevronDown } from "lucide-react-native";
import { createContext, type ReactNode, use, useState } from "react";
import { FlatList, Modal, Pressable, TextInput, type TextInputProps, View } from "react-native";

import { cx } from "./cx.ts";
import { useTokenColor } from "./foreground.tsx";
import { Icon } from "./Icon.tsx";
import { Text, wrapText } from "./Text.tsx";

interface FieldContextValue {
  label?: string;
  hint?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

interface FieldProps {
  label: ReactNode;
  // 入力の説明(文字数、書き方)
  hint?: ReactNode;
  // 誤り。あれば入力欄を誤りの見た目にし、読み上げで説明として読ませる
  error?: ReactNode;
  className?: string;
  // Input・Textarea・Select を1つ入れる。読み上げの名前と説明は Field が付ける
  children: ReactNode;
}

// ラベル・説明・誤りと、入力欄1つの組
export function Field({ label, hint, error, className, children }: FieldProps) {
  const text = (n: ReactNode) => (typeof n === "string" ? n : undefined);
  return (
    <View className={cx("gap-1.5", className)}>
      {wrapText(label, "text-sm font-medium")}
      <FieldContext
        value={{ label: text(label), hint: [text(error), text(hint)].filter(Boolean).join("。") || undefined, invalid: !!error }}
      >
        {children}
      </FieldContext>
      {hint && wrapText(hint, "text-xs text-fg-muted")}
      {error && wrapText(error, "text-xs text-danger-fg")}
    </View>
  );
}

const controlClass = "w-full rounded-md border border-border-strong bg-surface px-3 text-base text-fg focus:border-primary-fg";

export interface InputProps extends TextInputProps {
  className?: string;
  // 誤りの見た目にする(Field の中なら Field の error から決まる)
  invalid?: boolean;
}

function useControlProps({ invalid, editable, ...props }: InputProps) {
  const field = use(FieldContext);
  const placeholder = useTokenColor("fg-muted");
  const cursor = useTokenColor("primary-fg");
  return {
    placeholderTextColor: placeholder,
    selectionColor: cursor,
    cursorColor: cursor,
    accessibilityLabel: field?.label,
    accessibilityHint: field?.hint,
    editable,
    ...props,
    invalidClass: cx((invalid ?? field?.invalid) && "border-danger", editable === false && "opacity-50"),
  };
}

export function Input({ className, ...props }: InputProps) {
  const { invalidClass, ...rest } = useControlProps(props);
  return <TextInput className={cx(controlClass, "h-12", invalidClass, className)} {...rest} />;
}

// 複数行の入力。1行のときに Input と同じ高さ(h-12)になる
export function Textarea({ className, ...props }: InputProps) {
  const { invalidClass, ...rest } = useControlProps(props);
  return (
    <TextInput
      multiline
      textAlignVertical="top"
      className={cx(controlClass, "min-h-12 pt-3 pb-2 leading-snug", invalidClass, className)}
      {...rest}
    />
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  // まだ選んでいないときは undefined(placeholder を出す)
  value: T | undefined;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

// 選択肢から1つを選ぶ。押すと一覧を画面に重ねて出す
export function Select<T extends string>({ value, options, onChange, placeholder, disabled, className }: SelectProps<T>) {
  const field = use(FieldContext);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const shown = selected?.label ?? placeholder ?? "";
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={field?.label ? `${field.label}: ${shown}` : shown}
        accessibilityHint={field?.hint}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={cx(
          controlClass,
          "h-12 flex-row items-center justify-between active:bg-surface-muted",
          field?.invalid && "border-danger",
          disabled && "opacity-50",
          className,
        )}
      >
        <Text className={cx(!selected && "text-fg-muted")}>{shown}</Text>
        <Icon icon={ChevronDown} size={20} color="fg-muted" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end bg-overlay p-4 pb-safe-or-4">
          {/* 幕を押すと閉じる(選び直さない)。中身を包むと、読み上げで選択肢を選べなくなるので、後ろの別の要素にする */}
          <Pressable accessibilityLabel="閉じる" className="absolute inset-0" onPress={() => setOpen(false)} />
          <View className="max-h-[70%] w-full overflow-hidden rounded-xl border border-border bg-surface">
            {field?.label && <Text className="border-b border-border px-4 py-3 text-sm font-bold">{field.label}</Text>}
            <FlatList
              data={options}
              keyExtractor={(o) => o.value}
              renderItem={({ item, index }) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                    onPress={() => {
                      setOpen(false);
                      onChange(item.value);
                    }}
                    className={cx(
                      "min-h-12 flex-row items-center justify-between px-4 active:bg-surface-muted",
                      index > 0 && "border-t border-border",
                    )}
                  >
                    <Text className={cx(isSelected && "font-bold")}>{item.label}</Text>
                    {isSelected && <Icon icon={Check} size={20} color="primary-fg" />}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
