import { useState, useCallback } from "react";

export interface ValidationRule {
  validate: (value: unknown) => boolean;
  message: string;
}

export interface FieldConfig {
  rules: ValidationRule[];
}

export function useFormValidation(schema: Record<string, FieldConfig>) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateField = useCallback(
    (name: string, value: unknown) => {
      const config = schema[name];
      if (!config) return;
      for (const rule of config.rules) {
        if (!rule.validate(value)) {
          setErrors((prev) => ({ ...prev, [name]: rule.message }));
          return;
        }
      }
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    },
    [schema],
  );

  const validateAll = useCallback(
    (values: Record<string, unknown>) => {
      const newErrors: Record<string, string> = {};
      for (const [name, config] of Object.entries(schema)) {
        for (const rule of config.rules) {
          if (!rule.validate(values[name])) {
            newErrors[name] = rule.message;
            break;
          }
        }
      }
      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    [schema],
  );

  const clearErrors = useCallback(() => {
    setErrors({});
  }, []);

  return {
    errors,
    validateField,
    validateAll,
    clearErrors,
    hasErrors: Object.keys(errors).length > 0,
  };
}
