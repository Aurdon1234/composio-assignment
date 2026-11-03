import Link from "next/link";

export default function GuideNotFound() {
  return (
    <div className="space-y-3 py-10">
      <h1 className="text-2xl font-bold">No guide here yet</h1>
      <p className="text-zinc-600 dark:text-zinc-400">This app isn&apos;t in the library and hasn&apos;t been generated before.</p>
      <Link href="/" className="inline-block rounded-md bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
        Generate a guide
      </Link>
    </div>
  );
}
