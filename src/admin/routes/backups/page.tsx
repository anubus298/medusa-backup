import {defineRouteConfig} from "@medusajs/admin-sdk";
import {ServerStack} from "@medusajs/icons";
import {
  Container,
  Heading,
  Button,
  Table,
  StatusBadge,
  Toaster,
  toast,
  FocusModal,
  Input,
  Label,
  Text
} from "@medusajs/ui";
import {useEffect, useState} from "react";
import {formatDistanceToNow, parseISO} from "date-fns";
import {useNavigate} from "react-router-dom";

type Backup = {
  id: string;
  status: string;
  created_at: string;
  url?: string;
};

const Backups = () => {
  const AUTOMATIC_BACKUP = false;

  const [loading, setLoading] = useState<boolean>(true);
  const [backing, setBacking] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [openRestore, setOpenRestore] = useState(false);
  const [backupKey, setbackupKey] = useState<string>("");

  const navigate = useNavigate();

  useEffect(() => {
    fetchBackups();
  }, []);

  const fetchBackups = async () => {
    try {
      setLoading(true);
      const response = await fetch("/admin/backups/db-backup", {
        method: "GET",
        credentials: "include"
      });
      const data = await response.json();
      setBackups(data.backups);
    } catch (error) {
      console.error("Failed to fetch backups", error);
    } finally {
      setLoading(false);
    }
  };

  const handleBackup = async () => {
    try {
      setBacking(true);
      const response = await fetch("/admin/backups/db-backup", {
        method: "POST",
        credentials: "include"
      });
      if (response.ok) {
        toast.success("Backup created successfully");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        fetchBackups();
      } else {
        const errorData = await response.json();
        toast.error("Failed to create backup", {
          description: errorData?.error || "An unknown error occurred"
        });
      }
    } catch (error) {
      toast.error("Failed to create backup");
    } finally {
      setBacking(false);
    }
  };

  const handleRestore = async () => {
    setOpenRestore(false);
    try {
      setRestoring(true);
      const response = await fetch("/admin/backups/db-restore", {
        method: "POST",
        body: JSON.stringify({backupKey}),
        credentials: "include"
      });
      if (response.ok) {
        toast.success("Database restored successfully");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        navigate("/login");
      } else {
        const errorData = await response.json();
        toast.error("Failed to restore database", {
          description:
            errorData?.error ||
            errorData?.message ||
            "An unknown error occurred during restoration"
        });
      }
    } catch (error) {
      toast.error("Failed to restore database", {
        description: "There was an error attempting to restore the database."
      });
    } finally {
      setRestoring(false);
    }
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <StatusBadge color="green">Success</StatusBadge>;
      case "error":
        return <StatusBadge color="red">Error</StatusBadge>;
      case "loading":
        return <StatusBadge color="orange">Pending</StatusBadge>;
      default:
        return <StatusBadge color="grey">Inactive</StatusBadge>;
    }
  };

  const warningMessage =
    " ⚠️ Warning: Restoring a backup will roll your database back to the state it was in at the backup's timestamp. All changes made since then will be permanently lost. Proceed with caution.";

  return (
    <div className="flex flex-col md:flex-row gap-2 p-2">
      <Container className="flex flex-col gap-10">
        <Heading level="h1">Backups</Heading>
        <div className="flex flex-row gap-4">
          <Button variant="primary" onClick={handleBackup} isLoading={backing}>
            Backup
          </Button>
          <FocusModal open={openRestore} onOpenChange={setOpenRestore}>
            <FocusModal.Trigger asChild>
              <Button variant="secondary" isLoading={restoring}>
                Restore
              </Button>
            </FocusModal.Trigger>
            <FocusModal.Content>
              <FocusModal.Header>
                <Button onClick={handleRestore}>Save</Button>
              </FocusModal.Header>
              <FocusModal.Body className="flex flex-col items-center py-16">
                <div className="flex w-full max-w-lg flex-col gap-y-8">
                  <div className="flex flex-col gap-y-1">
                    <Heading>Confirm Restore</Heading>
                    <Text className="text-ui-fg-subtle">{warningMessage}</Text>
                  </div>
                  <div className="flex flex-col gap-y-2">
                    <Label htmlFor="key_name" className="text-ui-fg-subtle">
                      Key
                    </Label>
                    <Input
                      id="backup_key"
                      placeholder="Enter Backup Key"
                      value={backupKey}
                      onChange={(e) => setbackupKey(e.target.value)}
                    />
                  </div>
                </div>
              </FocusModal.Body>
            </FocusModal.Content>
          </FocusModal>
        </div>
        <p className="text-xs opacity-50">{warningMessage}</p>
        <StatusBadge color={AUTOMATIC_BACKUP ? "green" : "grey"}>
          Automatic Backups ({AUTOMATIC_BACKUP ? "On" : "Off"})
        </StatusBadge>
      </Container>
      <Container className="flex flex-col gap-10 p-0">
        {loading && backups.length == 0 ? (
          <div className="flex flex-row px-6 py-4 opacity-50 text-xs">
            Loading
          </div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell className="rounded-lg">
                  Status
                </Table.HeaderCell>
                <Table.HeaderCell className="rounded-lg">
                  Created At
                </Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            {backups?.length > 0 ? (
              <Table.Body>
                {backups.map((backup) => (
                  <Table.Row key={backup.id}>
                    <Table.Cell>{renderStatusBadge(backup.status)}</Table.Cell>
                    <Table.Cell>
                      {new Date(backup.created_at).toLocaleString()} (
                      {formatDistanceToNow(parseISO(backup.created_at), {
                        addSuffix: true
                      })}
                      )
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            ) : (
              <div className="flex flex-row px-6 py-2 opacity-50">
                No backups yet
              </div>
            )}
          </Table>
        )}
      </Container>
      <Toaster />
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Backups",
  icon: ServerStack
});

export default Backups;
