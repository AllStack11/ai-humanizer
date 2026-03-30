import {
  Badge,
  Button as MantineButton,
  Paper,
  Switch as MantineSwitch,
  TextInput,
  Textarea as MantineTextarea,
  Tooltip,
} from "@mantine/core";

function cx(...values) {
  return values.filter(Boolean).join(" ");
}

export function Card({ className = "", children, style }) {
  return (
    <Paper className={cx("ui-card", className)} style={style} radius={28} shadow="sm">
      {children}
    </Paper>
  );
}

Card.Content = function CardContent({ className = "", children, style }) {
  return (
    <div className={cx("ui-card-content", className)} style={style}>
      {children}
    </div>
  );
};

export function Button({
  className = "",
  children,
  color = "default",
  variant = "bordered",
  size = "md",
  tooltip = "",
  iconOnly = false,
  onPress,
  isDisabled = false,
  style,
  type = "button",
  ...props
}) {
  const variantMap = {
    bordered: "filled",
    solid: "filled",
    flat: "filled",
    light: "subtle",
  };

  // Removing hardcoded background colors and styles so app.css glassmorphism styling takes over.
  const button = (
    <MantineButton
      type={type}
      className={cx(
        "ui-button",
        `ui-button--${variant}`,
        `ui-button--${color}`,
        size === "sm" ? "ui-button--sm" : "ui-button--md",
        iconOnly && "ui-button--icon-only",
        isDisabled && "is-disabled",
        className
      )}
      onClick={onPress}
      disabled={isDisabled}
      variant="unstyled"
      radius="xl"
      size={size === "sm" ? "sm" : "md"}
      style={style}
      styles={{
        root: { paddingInline: 0 },
        label: { overflow: "visible" },
      }}
      {...props}
    >
      {children}
    </MantineButton>
  );

  if (!tooltip) return button;

  return (
    <Tooltip label={tooltip} withArrow openDelay={1500}>
      <span className="ui-tooltip-wrap">{button}</span>
    </Tooltip>
  );
}

export function Input({ className = "", style, ...props }) {
  return (
    <TextInput
      className={cx("ui-input-wrap", className)}
      styles={{
        input: {
          minHeight: 52,
          borderRadius: 16,
          borderColor: "var(--app-border)",
          background: "linear-gradient(180deg, var(--field-surface-top) 0%, var(--field-surface-bottom) 100%)",
          color: "var(--app-text)",
          boxShadow: "var(--field-shadow-inset)",
        },
      }}
      style={style}
      {...props}
    />
  );
}

export function TextArea({ className = "", style, ...props }) {
  return (
    <MantineTextarea
      className={cx("ui-input-wrap", className)}
      autosize={false}
      styles={{
        input: {
          minHeight: 120,
          borderRadius: 16,
          borderColor: "var(--app-border)",
          background: "linear-gradient(180deg, var(--field-surface-top) 0%, var(--field-surface-bottom) 100%)",
          color: "var(--textarea-text-color)",
          boxShadow: "var(--field-shadow-inset)",
          lineHeight: 1.65,
          padding: "14px 16px",
        },
      }}
      style={style}
      {...props}
    />
  );
}

export function Chip({ className = "", children, ...props }) {
  return (
    <Badge className={cx("ui-chip", className)} radius="xl" variant="light" {...props}>
      {children}
    </Badge>
  );
}

export function Switch({ isSelected, onChange, className = "", ...props }) {
  return (
    <MantineSwitch
      className={cx("ui-switch", className)}
      checked={Boolean(isSelected)}
      onChange={(event) => onChange?.(event.currentTarget.checked)}
      color="var(--accent)"
      {...props}
    />
  );
}

export function Spinner({ className = "", size = "md" }) {
  return (
    <span
      className={cx("ui-spinner", `ui-spinner--${size}`, className)}
      aria-hidden="true"
    />
  );
}
