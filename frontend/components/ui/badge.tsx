import React from 'react';
import MuiChip, { ChipProps as MuiChipProps } from '@mui/material/Chip';

export interface BadgeProps extends Omit<MuiChipProps, 'variant' | 'children'> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
  children?: React.ReactNode;
  label?: React.ReactNode;
}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ variant = 'default', children, label, ...props }, ref) => {
    const getMuiVariant = (v: BadgeProps['variant']) => {
      switch (v) {
        case 'outline':
          return 'outlined' as const;
        default:
          return 'filled' as const;
      }
    };

    const getColor = (v: BadgeProps['variant']) => {
      switch (v) {
        case 'destructive':
          return 'error' as const;
        default:
          return 'primary' as const;
      }
    };

    return (
      <MuiChip
        ref={ref}
        variant={getMuiVariant(variant)}
        color={getColor(variant)}
        size="small"
        label={label || children}
        {...props}
      />
    );
  }
);

Badge.displayName = 'Badge';
