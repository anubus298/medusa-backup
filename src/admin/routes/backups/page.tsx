import {defineRouteConfig} from "@medusajs/admin-sdk";
import {InformationCircle, ServerStack} from "@medusajs/icons";
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
  Copy,
  usePrompt
} from "@medusajs/ui";
import {useEffect, useState} from "react";
import {formatDistanceToNow, parseISO} from "date-fns";
import {useNavigate} from "react-router-dom";
import {
  actionBackup,
  actionFetch,
  actionDelete,
  actionRestore,
  AUTOMATIC_BACKUP,
  Backup,
  getBackupSizeString
} from "./helper";

const Backups = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [backing, setBacking] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [openRestore, setOpenRestore] = useState(false);
  const [backupDate, setBackupDate] = useState<string | null>(null);
  const [backupUrl, setBackupUrl] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const dialog = usePrompt();

  const navigate = useNavigate();

  useEffect(() => {
    fetchBackups();
  }, []);

  const fetchBackups = async () => {
    try {
      setLoading(true);
      const response = await actionFetch();
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
      const response = await actionBackup();
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
    if (restoring) return;
    setOpenRestore(false);
    try {
      setRestoring(true);
      const response = await actionRestore(backupUrl);
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

  const onRestoreItemClick = (url: string, date: string) => {
    setBackupDate(date);
    setBackupUrl(url);
    setOpenRestore(true);
  };

  const onDeleteItemClick = async (id: string) => {
    const confirmed = await dialog({
      title: "Are you sure?",
      description: "Please confirm this action"
    });

    if (!confirmed) return;

    setDeleteLoading(id);
    const response = await actionDelete(id);
    if (response.ok) {
      toast.success("Backup removed");
      fetchBackups();
    } else {
      const errorData = await response.json();
      toast.error("Failed to remove", {
        description:
          errorData?.error || errorData?.message || "An unknown error occurred"
      });
    }
  };

  const onRestoreClick = () => {
    setBackupDate("");
    setBackupUrl("");
    setOpenRestore(true);
  };

  return (
    <div className="flex flex-col gap-4 p-2">
      <Container className="flex flex-col gap-6">
        <Heading
          level="h1"
          className="flex flex-row justify-between items-center"
        >
          <span>Backups</span>
          <StatusBadge color={AUTOMATIC_BACKUP ? "green" : "grey"}>
            Automatic Backups ({AUTOMATIC_BACKUP ? "Enabled" : "Disabled"})
          </StatusBadge>
        </Heading>
        <div className="flex flex-row gap-4">
          <Button variant="primary" onClick={handleBackup} isLoading={backing}>
            Backup
          </Button>
          <Button
            variant="secondary"
            isLoading={restoring}
            onClick={onRestoreClick}
          >
            Restore
          </Button>
          <FocusModal open={openRestore} onOpenChange={setOpenRestore}>
            <FocusModal.Content>
              <FocusModal.Header>
                <Button variant="danger" onClick={handleRestore}>
                  Confirm
                </Button>
              </FocusModal.Header>
              <FocusModal.Body className="flex flex-col items-center py-16">
                <div className="flex w-full max-w-lg flex-col gap-y-8">
                  <div className="flex flex-col gap-y-1">
                    <Heading>Confirm Restore</Heading>
                    <p className="text-xs opacity-50 select-none scale-80">
                      <span className="flex flex-wrap items-center gap-2">
                        <InformationCircle />
                        Restoring this backup will revert your database to its
                        state at the time of the backup.
                      </span>
                    </p>
                  </div>
                  {backupDate && (
                    <div className="flex flex-col text-xs border rounded-lg p-4">
                      <span className="opacity-70">Restoring backup from</span>
                      <div className="text-green-700 dark:text-green-400">
                        {backupDate}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col gap-y-2">
                    <Input
                      id="backup_key"
                      placeholder="Enter URL"
                      value={backupUrl ?? ""}
                      onChange={(e) => setBackupUrl(e.target.value)}
                    />
                  </div>
                </div>
              </FocusModal.Body>
            </FocusModal.Content>
          </FocusModal>
        </div>
        <p className="text-xs opacity-50 select-none">
          <span className="flex flex-wrap items-center gap-2">
            <InformationCircle />
            Restoring a backup will revert your database to its state at the
            time of the backup. All changes made after that point will be lost.
            Please proceed with caution.
          </span>
        </p>
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
                  Backup
                </Table.HeaderCell>
                <Table.HeaderCell className="rounded-lg">URL</Table.HeaderCell>
                <Table.HeaderCell className="rounded-lg">
                  Status
                </Table.HeaderCell>
                <Table.HeaderCell className="rounded-lg">Size</Table.HeaderCell>
                <Table.HeaderCell className="rounded-lg">
                  Created At
                </Table.HeaderCell>
                <Table.HeaderCell className="rounded-lg">
                  Actions
                </Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            {backups?.length > 0 ? (
              <Table.Body>
                {backups.map((backup) => {
                  const timeAgo = formatDistanceToNow(
                    parseISO(backup.created_at),
                    {
                      addSuffix: true
                    }
                  );
                  const time = new Date(backup.created_at).toLocaleString();

                  return (
                    <Table.Row key={backup.id}>
                      <Table.Cell className="flex flex-row items-center gap-2">
                        {backup.id}
                      </Table.Cell>
                      <Table.Cell>
                        <Copy content={backup.fileUrl ?? ""} />
                      </Table.Cell>
                      <Table.Cell>
                        {renderStatusBadge(backup.status)}
                      </Table.Cell>
                      <Table.Cell>
                        {getBackupSizeString(
                          backup.metadata?.size,
                          backup.metadata?.originalSize
                        )}
                      </Table.Cell>
                      <Table.Cell className="flex flex-row items-center gap-2">
                        {time}
                        <span className="font-semibold">({timeAgo})</span>
                      </Table.Cell>
                      <Table.Cell className="">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            onRestoreItemClick(
                              backup.fileUrl ?? "",
                              `${time} (${timeAgo})`
                            )
                          }
                        >
                          Restore
                        </Button>
                        <Button
                          variant="secondary"
                          className="ml-2"
                          onClick={() => onDeleteItemClick(backup.id)}
                          isLoading={deleteLoading === backup.id}
                        >
                          Delete
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
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
  label: "Backups (V2)",
  icon: ServerStack
});

export default Backups;
