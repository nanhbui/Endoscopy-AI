'use client';

import React from 'react';
import MuiDialog from '@mui/material/Dialog';
import MuiDialogTitle from '@mui/material/DialogTitle';
import MuiDialogContentText from '@mui/material/DialogContentText';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';

interface DialogContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextType | null>(null);

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

export const Dialog = ({ open, onOpenChange, children }: DialogProps) => {
  const [isOpen, setIsOpen] = React.useState(open || false);

  React.useEffect(() => {
    if (open !== undefined) setIsOpen(open);
  }, [open]);

  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen);
    onOpenChange?.(newOpen);
  };

  return (
    <DialogContext.Provider value={{ open: isOpen, setOpen: handleOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
};

type DivProps = React.ComponentProps<'div'>;

export const DialogTrigger = React.forwardRef<HTMLDivElement, DivProps & { asChild?: boolean }>(
  ({ children, asChild: _asChild, ...props }, ref) => {
    const context = React.useContext(DialogContext);
    if (!context) return null;

    return (
      <div ref={ref} onClick={() => context.setOpen(true)} {...props}>
        {children}
      </div>
    );
  }
);
DialogTrigger.displayName = 'DialogTrigger';

export const DialogPortal = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

export const DialogClose = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(
  ({ children, ...props }, ref) => {
    const context = React.useContext(DialogContext);
    if (!context) return null;

    return (
      <button ref={ref} onClick={() => context.setOpen(false)} {...props}>
        {children}
      </button>
    );
  }
);
DialogClose.displayName = 'DialogClose';

export const DialogOverlay = React.forwardRef<HTMLDivElement, DivProps>((props, ref) => (
  <div ref={ref} {...props} />
));
DialogOverlay.displayName = 'DialogOverlay';

type DialogContentProps =
  Omit<React.ComponentProps<typeof MuiDialog>, 'open' | 'onClose'> & { showCloseButton?: boolean };

export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ children, showCloseButton = true, ...props }, ref) => {
    const context = React.useContext(DialogContext);
    if (!context) return null;

    return (
      <MuiDialog
        ref={ref}
        open={context.open}
        onClose={() => context.setOpen(false)}
        {...props}
      >
        {showCloseButton && (
          <IconButton
            aria-label="close"
            onClick={() => context.setOpen(false)}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: 'grey.500',
            }}
          >
            <CloseIcon />
          </IconButton>
        )}
        {children}
      </MuiDialog>
    );
  }
);
DialogContent.displayName = 'DialogContent';

export const DialogHeader = React.forwardRef<HTMLDivElement, DivProps>(
  (props, ref) => <div ref={ref} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

export const DialogFooter = React.forwardRef<HTMLDivElement, DivProps>(
  (props, ref) => <div ref={ref} {...props} />
);
DialogFooter.displayName = 'DialogFooter';

export const DialogTitle = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof MuiDialogTitle>>(
  (props, ref) => <MuiDialogTitle ref={ref} {...props} />
);
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<HTMLParagraphElement, React.ComponentProps<typeof MuiDialogContentText>>(
  (props, ref) => <MuiDialogContentText ref={ref} {...props} />
);
DialogDescription.displayName = 'DialogDescription';
