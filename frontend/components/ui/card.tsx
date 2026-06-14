import React from 'react';
import MuiCard from '@mui/material/Card';
import MuiCardContent from '@mui/material/CardContent';
import MuiCardActions from '@mui/material/CardActions';
import Box from '@mui/material/Box';
import Typography, { TypographyProps } from '@mui/material/Typography';
import { styled } from '@mui/material/styles';

const StyledCard = styled(MuiCard)(() => ({
  boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
  '&:hover': {
    boxShadow: '0 3px 6px rgba(0,0,0,0.16)',
  },
}));

export const Card = React.forwardRef<HTMLDivElement, Omit<React.ComponentProps<typeof MuiCard>, 'ref'> & { size?: 'default' | 'sm' }>(
  ({ size = 'default', ...props }, ref) => (
    <StyledCard ref={ref} {...props} />
  )
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof Box>>(
  ({ sx, ...props }, ref) => (
    <Box
      ref={ref}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        p: 2,
        ...sx,
      }}
      {...props}
    />
  )
);
CardHeader.displayName = 'CardHeader';

export const CardContent = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof MuiCardContent>>(
  ({ sx, ...props }, ref) => (
    <MuiCardContent ref={ref} sx={{ p: 2, pt: 0, '&:last-child': { pb: 2 }, ...sx }} {...props} />
  )
);
CardContent.displayName = 'CardContent';

export const CardTitle = React.forwardRef<HTMLDivElement, TypographyProps>(
  (props, ref) => (
    <Typography ref={ref} variant="h6" component="div" sx={{ fontWeight: 600, mb: 1 }} {...props} />
  )
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<HTMLDivElement, TypographyProps>(
  (props, ref) => (
    <Typography ref={ref} variant="body2" color="textSecondary" {...props} />
  )
);
CardDescription.displayName = 'CardDescription';

export const CardAction = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  (props, ref) => <Box ref={ref} {...props} />
);
CardAction.displayName = 'CardAction';

export const CardFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof MuiCardActions>>(
  ({ sx, ...props }, ref) => <MuiCardActions ref={ref} sx={{ p: 2, pt: 0, ...sx }} {...props} />
);
CardFooter.displayName = 'CardFooter';
