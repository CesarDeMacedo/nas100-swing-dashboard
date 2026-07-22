import {
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  Clock3,
  Hourglass,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';

import type { Action } from './analysis';

export type ActionStateDefinition = {
  label: string;
  shortLabel: string;
  primaryColor: string;
  borderColor: string;
  iconColor: string;
  icon: LucideIcon;
  bannerClassName: string;
  overlayClassName: string;
  badgeClassName: string;
};

export const ACTION_STATES: Record<Action, ActionStateDefinition> = {
  BUY: {
    label: 'BUY',
    shortLabel: 'BUY',
    primaryColor: '#45d483',
    borderColor: '#248f59',
    iconColor: '#77e7a7',
    icon: ArrowUpRight,
    bannerClassName: 'action-banner action-banner--buy',
    overlayClassName: 'decision-overlay decision-overlay--buy',
    badgeClassName: 'action-badge action-badge--buy',
  },
  SELL: {
    label: 'SELL',
    shortLabel: 'SELL',
    primaryColor: '#ff525c',
    borderColor: '#b92f3a',
    iconColor: '#ff7780',
    icon: ArrowDownRight,
    bannerClassName: 'action-banner action-banner--sell',
    overlayClassName: 'decision-overlay decision-overlay--sell',
    badgeClassName: 'action-badge action-badge--sell',
  },
  WAIT: {
    label: 'WAIT',
    shortLabel: 'WAIT',
    primaryColor: '#f6a20d',
    borderColor: '#b97808',
    iconColor: '#ffc65c',
    icon: Hourglass,
    bannerClassName: 'action-banner action-banner--wait',
    overlayClassName: 'decision-overlay decision-overlay--wait',
    badgeClassName: 'action-badge action-badge--wait',
  },
  NO_TRADE: {
    label: 'NO TRADE',
    shortLabel: 'NO TRADE',
    primaryColor: '#ff525c',
    borderColor: '#7f3440',
    iconColor: '#ff7780',
    icon: Ban,
    bannerClassName: 'action-banner action-banner--no-trade',
    overlayClassName: 'decision-overlay decision-overlay--no-trade',
    badgeClassName: 'action-badge action-badge--no-trade',
  },
  WAIT_FOR_PULLBACK: {
    label: 'WAIT FOR PULLBACK',
    shortLabel: 'PULLBACK',
    primaryColor: '#f6a20d',
    borderColor: '#b97808',
    iconColor: '#ffc65c',
    icon: RotateCcw,
    bannerClassName: 'action-banner action-banner--wait',
    overlayClassName: 'decision-overlay decision-overlay--wait',
    badgeClassName: 'action-badge action-badge--wait',
  },
  WAIT_FOR_NEXT_4H_CLOSE: {
    label: 'WAIT FOR NEXT 4H CLOSE',
    shortLabel: 'NEXT 4H CLOSE',
    primaryColor: '#f6a20d',
    borderColor: '#b97808',
    iconColor: '#ffc65c',
    icon: Clock3,
    bannerClassName: 'action-banner action-banner--wait',
    overlayClassName: 'decision-overlay decision-overlay--wait',
    badgeClassName: 'action-badge action-badge--wait',
  },
};

export const getActionState = (action: Action) => ACTION_STATES[action];
