import { useEffect, useRef, useState } from 'react';
import { Ticket, User, EventItem, CheckInSession } from '../types';
import { soundFX } from '../utils/audio';
import { scanTicket } from '../lib/buymeshoApi';
import { mapValidatorTicket } from '../lib/validatorMappers';
import { getStoredToken } from '../lib/buymeshoApi';
import { decodeTicketCredential, isSignedTicketCredential, verifyTicketCredential } from '../lib/ticketCredential';

type ScanResult = {
  ticket: Ticket;
  scanTime: string;
  isDuplicate: boolean;
  isOfflineQueued?: boolean;
};

type ScannerOptions = {
  selectedEvent: EventItem | null;
  currentUser: User | null;
  activeSession: CheckInSession | null;
  tickets: Ticket[];
  isOnline: boolean;
  isSimulatedOffline: boolean;
  updateTicketStatus: (ticketId: string, newStatus: Ticket['status'], gateNameOverride?: string, staffNameOverride?: string, timestampOverride?: string, isOfflineAction?: boolean) => void;
};

export function useValidatorScanner({ selectedEvent, currentUser, activeSession, tickets, isOnline, isSimulatedOffline, updateTicketStatus }: ScannerOptions) {
  const [isContinuousScan, setIsContinuousScan] = useState(true);
  const [activeScanResult, setActiveScanResult] = useState<ScanResult | null>(null);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScanThrottleRef = useRef({ code: '', time: 0 });

  useEffect(() => () => {
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
  }, []);

  const handleDismissResult = () => {
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
    autoDismissTimerRef.current = null;
    setActiveScanResult(null);
  };

  const scheduleAutoDismiss = (delay: number) => {
    if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
    autoDismissTimerRef.current = setTimeout(() => {
      setActiveScanResult(null);
      autoDismissTimerRef.current = null;
    }, delay);
  };

  const handleScanTicket = async (scannedCode: string) => {
    if (!selectedEvent || !currentUser || !activeSession?.active) return;
    const now = Date.now();
    if (lastScanThrottleRef.current.code === scannedCode && now - lastScanThrottleRef.current.time < 1500) return;
    lastScanThrottleRef.current = { code: scannedCode, time: now };

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const effectiveOffline = !isOnline || isSimulatedOffline;
    const signedCredential = isSignedTicketCredential(scannedCode)
      ? await verifyTicketCredential(scannedCode)
      : null;

    if (isSignedTicketCredential(scannedCode) && !signedCredential) {
      soundFX.playError();
      setActiveScanResult(null);
      return;
    }

    if (signedCredential && signedCredential.eid !== selectedEvent.id) {
      soundFX.playError();
      setActiveScanResult(null);
      return;
    }

    const lookupCode = signedCredential?.tid ?? decodeTicketCredential(scannedCode)?.tid ?? scannedCode;
    const foundTicket = tickets.find((ticket) => ticket.qrPayload === scannedCode || ticket.id === lookupCode);

    if (!foundTicket) {
      soundFX.playError();
      setActiveScanResult(null);
      return;
    }

    if (effectiveOffline) {
      if (foundTicket.status !== 'Waiting Entry') {
        soundFX.playError();
        setActiveScanResult({ ticket: foundTicket, scanTime: timestamp, isDuplicate: foundTicket.status === 'Inside', isOfflineQueued: false });
        scheduleAutoDismiss(2500);
        return;
      }
      soundFX.playSuccess();
      updateTicketStatus(foundTicket.id, 'Inside', activeSession.gateName, currentUser.name, timestamp, true);
      const updatedTicket = { ...foundTicket, status: 'Inside' as const, lastCheckedInTime: timestamp, lastGateName: activeSession.gateName, lastStaffName: currentUser.name };
      setActiveScanResult({ ticket: updatedTicket, scanTime: timestamp, isDuplicate: false, isOfflineQueued: true });
      scheduleAutoDismiss(isContinuousScan ? 1800 : 2500);
      return;
    }

    try {
      const response = await scanTicket(getStoredToken(), {
        code: scannedCode,
        eventId: selectedEvent.id,
        gateName: activeSession.gateName,
        staffName: currentUser.name,
        allowReentry: false,
      });

      const serverTicket = response.data?.ticket;
      if (!serverTicket) {
        soundFX.playError();
        setActiveScanResult(null);
        return;
      }

      const authoritativeTicket = mapValidatorTicket(serverTicket, selectedEvent.id);
      const accepted = response.data?.result === 'accepted';
      const duplicate = response.data?.result === 'already_applied' || authoritativeTicket.status === 'Inside';

      if (accepted) {
        soundFX.playSuccess();
        updateTicketStatus(authoritativeTicket.id, authoritativeTicket.status, activeSession.gateName, currentUser.name, timestamp, false);
      } else {
        soundFX.playError();
      }

      setActiveScanResult({
        ticket: authoritativeTicket,
        scanTime: timestamp,
        isDuplicate: duplicate,
        isOfflineQueued: false,
      });
      scheduleAutoDismiss(isContinuousScan ? 1800 : 2500);
    } catch {
      soundFX.playError();
      setActiveScanResult({ ticket: foundTicket, scanTime: timestamp, isDuplicate: false, isOfflineQueued: false });
      scheduleAutoDismiss(2500);
    }
  };

  return { isContinuousScan, setIsContinuousScan, activeScanResult, handleScanTicket, handleDismissResult };
}

export type ValidatorScanner = ReturnType<typeof useValidatorScanner>;
